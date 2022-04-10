const fs = require('fs');
const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const multer = require("multer");
const helmet = require('helemt');
const compression = require('compression');
const morgan = require('morgan');

const { init: initSocketIO } = require("./socketIO.js");
const { graphqlHTTP } = require("express-graphql");
const { clearImage } = require("./util/file.js");
const auth = require("./middleware/auth.js");
const graphqlSchema = require("./graphql/schema.js");
const graphqlResolver = require("./graphql/resolvers.js");
const feedRoutes = require("./routes/feed");
const authRoutes = require("./routes/auth");
const { mongoConnect } = require("./util/database.js");

dotenv.config({ path: "./config.env" }); // Load Config

const app = express();

app.use(helmet());

const fileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "images");
  },
  filename: (req, file, cb) => {
    cb(null, new Date().toISOString() + "-" + file.originalname);
  },
});

const fileFilter = (req, file, cb) => {
  if (
    file.mimetype === "image/png" ||
    file.mimetype === "image/jpg" ||
    file.mimetype === "image/jpeg"
  ) {
    cb(null, true);
  } else {
    cb(null, false);
  }
};

const accessLogStream = fs.fs.createWriteStream(
  path.join(__dirname, 'access.log'), {flags: 'a'}
);

app.use(helmet());
app.use(compression());
app.morgan('combined', {stream: accessLogStream});

// app.use(bodyParser.urlencoded()); // x-www-form-urlencoded <form>
app.use(bodyParser.json()); // application/json
app.use(
  multer({ storage: fileStorage, fileFilter: fileFilter }).single("image")
);
app.use("/images", express.static(path.join(__dirname, "images")));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "OPTIONS, GET, POST, PUT, PATCH, DELETE"
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use("/feed", feedRoutes);
app.use("/auth", authRoutes);

app.use(auth);
app.put("/post-image", (req, res, next) => {
  if (!req.isAuth) {
    throw new Error("Not Authenticated");
  }

  if (!req.file) {
    return res.status(200).json({ message: "No File Provided" });
  }
  if (req.body.oldPath) {
    clearImage(req.body.oldPath);
  }

  return res
    .status(201)
    .json({ message: "File Stored", filePath: req.file.path });
});

app.use(
  "/graphql",
  graphqlHTTP({
    schema: graphqlSchema,
    rootValue: graphqlResolver,
    graphiql: true,
    formatError(err) {
      if (!err.originalError) {
        return err;
      }

      const data = err.originalError.data;
      const message = err.message || "An Error Occured";
      const code = err.originalError.code || 500;
      return { message: message, status: code, data: data };
    },
  })
);

app.use((error, req, res, next) => {
  if (error) {
    console.log(error);
    const status = error.statusCode || 500;
    const message = error.message;
    const data = error.data;
    res.status(status).json({ message: message, data: data });
  }
});

mongoConnect(() => {
  const server = app.listen(8080);
  const socketIO = initSocketIO(server);
  socketIO.on("connection", (socket) => {
    console.log("Client Connected");
  });
});
