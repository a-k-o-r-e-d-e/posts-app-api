import { ApolloServer } from "apollo-server-express";
import { ApolloServerPluginLandingPageGraphQLPlayground } from "apollo-server-core";
import fs from "fs";
import path from "path";
import express, { NextFunction, Response } from "express";
import dotenv from "dotenv";
import multer from "multer";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import { buildSchema } from "type-graphql";

import { init as initSocketIO } from "./socketIO";
import { clearImage } from "./util/file";
import auth from "./middleware/is-auth";
import { errorHandler } from "./middleware/error.middleware";
import { notFoundHandler } from "./middleware/not-found.middleware";
import { RequestWithAuthData } from "./models/auth_request";
import { mongoConnect } from "./util/database";
import { PostResolver } from "./graphql/resolvers/Post";
import { UserResolver } from "./graphql/resolvers/User";
import feedRoutes from "./routes/feed";
import authRoutes from "./routes/auth";
import HttpException from "./models/http-exception";

dotenv.config({ path: "./config.env" }); // Load Config

const main =async () => {

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

const fileFilter = (
  req: RequestWithAuthData,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
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

const accessLogStream = fs.createWriteStream(
  path.join(__dirname, "access.log"),
  { flags: "a" }
);

app.use(helmet());
app.use(compression());
app.use(morgan("combined", { stream: accessLogStream }));

app.use(express.json()); // application/json
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
app.put(
  "/post-image",
  (req: RequestWithAuthData, res: Response, next: NextFunction) => {
    if (!req.isAuth) {
      throw new HttpException(401, "Not Authenticated");
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
  }
);

const schema = await buildSchema({
  resolvers: [
    PostResolver,
    UserResolver
  ],
  emitSchemaFile: true,
  validate: false
});

const apolloServer = new ApolloServer({
  schema,
  plugins: [ApolloServerPluginLandingPageGraphQLPlayground]
});


await apolloServer.start();
apolloServer.applyMiddleware({app});


// app.use(
//   "/graphql",
//   graphqlHTTP({
//     schema: graphqlSchema,
//     rootValue: graphqlResolver,
//     graphiql: true,
//     formatError(err) {
//       if (!err.originalError) {
//         return err;
//       }

//       const originalError = err.originalError as HttpException;

//       const data = originalError.data;
//       const message = err.message || "An Error Occured";
//       const code = originalError.statusCode || 500;
//       return { message: message, status: code, data: data };
//     },
//   })
// );

// error handlers
app.use(errorHandler);
app.use(notFoundHandler);

mongoConnect(() => {
  const server = app.listen({port: 8080}, () => {
    console.log(
      `🚀 Server ready!!! 
      
      GraphQl is listening at ==> http://localhost:8080${apolloServer.graphqlPath}`
    );
  } );
  const socketIO = initSocketIO(server);
  socketIO.on("connection", (socket) => {
    console.log("Socket IO Client Connected");
  });
});


}

main().catch((error) => {
  console.log(error, "error");
});


