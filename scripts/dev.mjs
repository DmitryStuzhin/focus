import {createServer} from './server.mjs';
const argIndex=process.argv.indexOf('--port');
const port=Number(process.env.PORT || (argIndex>=0?process.argv[argIndex+1]:3000));
createServer().listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Focus listening on port ${port}`));
