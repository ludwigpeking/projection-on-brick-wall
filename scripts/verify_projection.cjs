"use strict";
const assert=require("node:assert/strict");
const projection=require("../projection.js");
const screenCorners=[[-0.24,-0.35],[0.22,-0.31],[0.19,0.29],[-0.21,0.32]];
for(const dimensions of [[1080,1920],[1080,2048],[1920,1080],[2048,1080],[2160,3840],[3840,2160]]) {
    const aspectRatio=dimensions[0]/dimensions[1];
    const framing=projection.fitWall(screenCorners,aspectRatio);
    const usage=projection.pixelUsage(screenCorners,framing,...dimensions);
    assert(!usage.clipped,"Fitting must retain all wall corners.");
    assert(Math.abs(framing[0]*aspectRatio-framing[1])<1e-10,"Fitting must preserve proportions, not stretch the wall.");
    const horizontalFill=usage.width/dimensions[0];
    const verticalFill=usage.height/dimensions[1];
    assert(Math.abs(Math.max(horizontalFill,verticalFill)-0.98)<1e-10,"One output dimension must use 98% of the available pixels.");
    assert(usage.areaFraction>0 && usage.areaFraction<1);
}
console.log("PASS: portrait/landscape Full HD, DCI 2K, and 4K UHD fit; no clipped wall corners; uniform magnification; 98% limiting-dimension use.");
