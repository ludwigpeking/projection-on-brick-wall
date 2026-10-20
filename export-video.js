"use strict";
const exportButton=document.createElement("button");
exportButton.textContent="Export both 4K videos";
exportButton.id="export-both-videos";
const exportStatus=document.createElement("p");
exportStatus.id="export-status";
exportStatus.textContent="4K export station · 30 fps · loop-ready surf soundtrack";
const exportPanel=document.createElement("div");
exportPanel.style.cssText="position:sticky;top:0;z-index:20;background:#101415;padding:16px;border-bottom:1px solid #79664d";
exportPanel.append(exportButton,exportStatus);
document.body.prepend(exportPanel);
async function exportRequest(endpoint,body) {
    const response=await fetch(endpoint,{method:"POST",body:body});
    const result=await response.json();
    if(!response.ok || result.error)throw new Error(result.error || "Export request failed");
    return result;
}
function encodedFrame() {
    // toBlob schedules idle work that Chromium can starve in background tabs.
    // Synchronous JPEG capture preserves every frame without that idle queue.
    const encodedImageUrl=previewCanvas.toDataURL("image/jpeg",0.98);
    const encodedImageBytes=atob(encodedImageUrl.slice(encodedImageUrl.indexOf(",")+1));
    const imageByteArray=new Uint8Array(encodedImageBytes.length);
    for(let byteIndex=0;byteIndex<encodedImageBytes.length;byteIndex++) {
        imageByteArray[byteIndex]=encodedImageBytes.charCodeAt(byteIndex);
    }
    return new Blob([imageByteArray],{type:"image/jpeg"});
}
function yieldExportWork() {
    return new Promise(function(resolve){
        const messageChannel=new MessageChannel();
        messageChannel.port1.onmessage=function(){messageChannel.port1.close();messageChannel.port2.close();resolve();};
        messageChannel.port2.postMessage(null);
    });
}
exportButton.addEventListener("click",async function(){
    if(!rendererReady){exportStatus.textContent="Renderer is still loading. Try again shortly.";return;}
    exportButton.disabled=true;
    musicPlayer.pause();
    exportInProgress=true;
    try {
        const configuration=await (await fetch("export-settings.json")).json();
        for(const [settingName,settingValue] of Object.entries(configuration.settings)) {
            settings[settingName]=settingValue;
            document.getElementById(settingName).value=String(settingValue);
        }
        if(configuration.photoCorners)photoCorners=configuration.photoCorners.map(function(corner){return corner.slice();});
        selectedMusic="surf";
        document.getElementById("show-grid").checked=false;
        document.getElementById("edit-corners").checked=false;
        document.getElementById("projector-resolution").value="3840";
        document.getElementById("projector-framing").value="fit";
        rebuildMasonry();
        updatePhotographMatrix();
        const frameCount=2922;
        const durationSeconds=musicOptions.surf.duration;
        const existingJob=await (await fetch("/export/status")).json();
        const orientations=["portrait","landscape"];
        for(const orientation of orientations) {
            if(existingJob.state==="rendering" && orientations.indexOf(orientation)<orientations.indexOf(existingJob.orientation))continue;
            document.getElementById("projector-orientation").value=orientation;
            setDisplayMode("projector");
            updateLabels();
            const resumeFrameIndex=existingJob.state==="rendering" && existingJob.orientation===orientation ? existingJob.receivedFrames : 0;
            if(!resumeFrameIndex)await exportRequest("/export/start",JSON.stringify({orientation:orientation,settings:settings,photoCorners:photoCorners,resolution:projectorOutputDimensions(),framing:"fit",viewerAngle:settings["viewer-angle"],projectorAngle:settings["projector-angle"]}));
            const startedMilliseconds=performance.now();
            for(let frameIndex=resumeFrameIndex;frameIndex<frameCount;frameIndex++) {
                currentSeconds=frameIndex===frameCount-1 ? durationSeconds : frameIndex*durationSeconds/frameCount;
                renderFrame();
                const frame=await encodedFrame();
                await exportRequest("/export/frame?index="+frameIndex,frame);
                if(frameIndex%15===0) {
                    const elapsedSeconds=(performance.now()-startedMilliseconds)/1000;
                    exportStatus.textContent=orientation+" · "+(100*(frameIndex+1)/frameCount).toFixed(1)+"% · "+(frameIndex+1)+" / "+frameCount+" frames · "+elapsedSeconds.toFixed(0)+"s elapsed";
                    await yieldExportWork();
                }
            }
            exportStatus.textContent=orientation+" · finalizing MP4 with music";
            const result=await exportRequest("/export/finish","");
            if(result.state!=="complete")throw new Error(result.error || "Encoder did not complete");
        }
        exportStatus.textContent="Complete · both 4K MP4 videos saved with music in exports";
        const playerLink=document.createElement("a");
        playerLink.href="exports/loop-player.html";
        playerLink.textContent="Open the looping video player";
        exportPanel.append(playerLink);
    }catch(error){exportStatus.textContent="Export stopped: "+error.message;console.error(error);}
    finally {exportInProgress=false;exportButton.disabled=false;requestDraw();}
});
