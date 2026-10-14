"use strict";
const http = require("node:http");
const fileSystem = require("node:fs");
const path = require("node:path");
const projectRoot = __dirname;
const contentTypes = {".html":"text/html; charset=utf-8",".css":"text/css",".js":"text/javascript",".png":"image/png",".wav":"audio/wav",".json":"application/json"};
http.createServer(function(request,response) {
    const relativePath = decodeURIComponent(new URL(request.url,"http://127.0.0.1").pathname);
    const requestedPath = path.resolve(projectRoot,"." + (relativePath === "/" ? "/index.html" : relativePath));
    if (!requestedPath.startsWith(projectRoot + path.sep)) {response.writeHead(403);response.end();return;}
    fileSystem.stat(requestedPath,function(error,fileStats) {
        if(error || !fileStats.isFile()){response.writeHead(404);response.end("Not found");return;}
        const contentType=contentTypes[path.extname(requestedPath)] || "application/octet-stream";
        let startByte=0;
        let endByte=fileStats.size-1;
        if(request.headers.range) {
            const rangeMatch=/bytes=(\d+)-(\d*)/.exec(request.headers.range);
            if(rangeMatch){startByte=Number(rangeMatch[1]);endByte=rangeMatch[2]?Math.min(Number(rangeMatch[2]),endByte):endByte;}
            if(startByte>endByte){response.writeHead(416);response.end();return;}
            response.writeHead(206,{"Content-Type":contentType,"Content-Range":"bytes "+startByte+"-"+endByte+"/"+fileStats.size,"Accept-Ranges":"bytes","Content-Length":endByte-startByte+1});
        } else response.writeHead(200,{"Content-Type":contentType,"Content-Length":fileStats.size,"Accept-Ranges":"bytes","Cache-Control":"no-cache"});
        if(request.method==="HEAD"){response.end();return;}
        fileSystem.createReadStream(requestedPath,{start:startByte,end:endByte}).pipe(response);
    });
}).listen(8840,"127.0.0.1",function(){console.log("Preview ready: http://127.0.0.1:8840");});
