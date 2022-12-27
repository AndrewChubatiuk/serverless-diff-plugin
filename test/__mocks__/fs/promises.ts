import { fs } from 'memfs';
const promises = fs.promises;
//const mkdir = promises.mkdir;
//const readFile = promises.readFile;
//const writeFile = promises.writeFile;
export = promises; //{ mkdir, readFile, writeFile }
