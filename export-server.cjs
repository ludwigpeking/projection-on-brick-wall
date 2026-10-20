"use strict";
const http=require("node:http");
const fileSystem=require("node:fs");
const path=require("node:path");
const childProcess=require("node:child_process");
const root=__dirname;
const outputDirectory=path.join(root,"exports");
fileSystem.mkdirSync(outputDirectory,{recursive:true});
const supportDirectory=path.join(outputDirectory,"support");
fileSystem.mkdirSync(supportDirectory,{recursive:true});
let activeJob=null;
function respond(response,status,value) {
    response.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store"});
    response.end(JSON.stringify(value));
}
async function requestBody(request) {
    const chunks=[];
    let totalBytes=0;
    for await(const chunk of request) {
        totalBytes+=chunk.length;
        if(totalBytes>40*1024*1024)throw new Error("Frame exceeded request size limit");
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}
function statusRecord() {
    if(!activeJob)return {state:"idle"};
    return {state:activeJob.state,orientation:activeJob.orientation,receivedFrames:activeJob.receivedFrames,totalFrames:activeJob.totalFrames,output:activeJob.output,error:activeJob.error};
}
function saveStatus() {fileSystem.writeFileSync(path.join(supportDirectory,"render-status.json"),JSON.stringify(statusRecord(),null,2));}
function startJob(configuration) {
    if(activeJob && ["rendering","encoding"].includes(activeJob.state))throw new Error("An export is already running");
    if(!["portrait","landscape"].includes(configuration.orientation))throw new Error("Invalid orientation");
    const orientation=configuration.orientation;
    const output=path.join(outputDirectory,"brick-ghosts-4k-"+orientation+".mp4");
    const totalFrames=2922;
    const durationSeconds=totalFrames/30;
    const videoEncoderArguments=process.platform==="darwin"
        ? ["-c:v","h264_videotoolbox","-q:v","75","-bf","0"]
        : ["-c:v","h264_nvenc","-preset","p5","-tune","hq","-rc","vbr","-cq","18","-b:v","0","-bf","2"];
    const args=["-hide_banner","-y","-f","image2pipe","-framerate","30","-vcodec","mjpeg","-i","pipe:0","-i",path.join(root,"audio","surf-4k-loop.wav"),"-map","0:v:0","-map","1:a:0",...videoEncoderArguments,"-pix_fmt","yuv420p","-profile:v","high","-level:v","5.1","-g","60","-c:a","aac","-b:a","320k","-ar","48000","-af","volume=0.55","-t",String(durationSeconds),"-movflags","+faststart",output];
    const log=fileSystem.createWriteStream(path.join(supportDirectory,orientation+"-encode.log"));
    const encoder=childProcess.spawn("ffmpeg",args,{windowsHide:true,stdio:["pipe","ignore","pipe"]});
    activeJob={state:"rendering",orientation:orientation,receivedFrames:0,totalFrames:totalFrames,output:output,encoder:encoder,error:null};
    const job=activeJob;
    encoder.stderr.pipe(log);
    encoder.stdin.on("error",function(error){job.error=error.message;job.state="failed";saveStatus();});
    encoder.on("error",function(error){job.error=error.message;job.state="failed";saveStatus();});
    job.completion=new Promise(function(resolve){encoder.on("close",function(exitCode){job.state=exitCode===0 && job.receivedFrames===totalFrames ? "complete" : "failed";if(job.state==="failed")job.error=job.error || "Encoder exit "+exitCode+"; received "+job.receivedFrames+" frames";log.end();saveStatus();resolve(statusRecord());});});
    fileSystem.writeFileSync(path.join(supportDirectory,orientation+"-settings.json"),JSON.stringify({...configuration,frameRate:30,totalFrames:totalFrames,durationSeconds:durationSeconds,audio:"surf-4k-loop.wav",audioGain:0.55},null,2));
    saveStatus();
    return statusRecord();
}
const contentTypes={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".png":"image/png",".jpg":"image/jpeg",".wav":"audio/wav",".mp4":"video/mp4",".json":"application/json"};
http.createServer(async function(request,response){
    try {
        const requestUrl=new URL(request.url,"http://127.0.0.1:8841");
        if(requestUrl.pathname==="/export/status"){respond(response,200,statusRecord());return;}
        if(request.method==="POST" && requestUrl.pathname==="/export/start") {respond(response,200,startJob(JSON.parse((await requestBody(request)).toString())));return;}
        if(request.method==="POST" && requestUrl.pathname==="/export/frame") {
            if(!activeJob || activeJob.state!=="rendering")throw new Error("No active render");
            const frameIndex=Number(requestUrl.searchParams.get("index"));
            if(frameIndex!==activeJob.receivedFrames)throw new Error("Unexpected frame order");
            const frame=await requestBody(request);
            if(frame[0]!==255 || frame[1]!==216)throw new Error("Expected JPEG frame");
            if([0,264,577,activeJob.totalFrames-1].includes(frameIndex))fileSystem.writeFileSync(path.join(supportDirectory,activeJob.orientation+"-frame-"+String(frameIndex).padStart(4,"0")+".jpg"),frame);
            await new Promise(function(resolve,reject){activeJob.encoder.stdin.write(frame,function(error){if(error)reject(error);else resolve();});});
            activeJob.receivedFrames++;
            if(activeJob.receivedFrames%30===0)saveStatus();
            respond(response,200,{receivedFrames:activeJob.receivedFrames});return;
        }
        if(request.method==="POST" && requestUrl.pathname==="/export/finish") {
            if(!activeJob || activeJob.receivedFrames!==activeJob.totalFrames)throw new Error("Missing frames");
            activeJob.state="encoding";saveStatus();activeJob.encoder.stdin.end();
            respond(response,200,await activeJob.completion);return;
        }
        const requestedPath=path.resolve(root,"."+(requestUrl.pathname==="/" ? "/render.html" : decodeURIComponent(requestUrl.pathname)));
        if(!requestedPath.startsWith(root+path.sep)){response.writeHead(403);response.end();return;}
        if(!fileSystem.existsSync(requestedPath) || !fileSystem.statSync(requestedPath).isFile()){response.writeHead(404);response.end();return;}
        const size=fileSystem.statSync(requestedPath).size;
        const range=/bytes=(\d+)-(\d*)/.exec(request.headers.range || "");
        const startByte=range ? Number(range[1]) : 0;
        const endByte=range && range[2] ? Math.min(size-1,Number(range[2])) : size-1;
        const headers={"Content-Type":contentTypes[path.extname(requestedPath)] || "application/octet-stream","Content-Length":endByte-startByte+1,"Cache-Control":"no-cache","Accept-Ranges":"bytes"};
        if(range)headers["Content-Range"]="bytes "+startByte+"-"+endByte+"/"+size;
        response.writeHead(range?206:200,headers);
        if(request.method==="HEAD")response.end();else fileSystem.createReadStream(requestedPath,{start:startByte,end:endByte}).pipe(response);
    }catch(error){respond(response,500,{error:error.message});}
}).listen(8841,"127.0.0.1",function(){console.log("4K export station: http://127.0.0.1:8841/");});
