"use strict";
const BrickProjection = (function() {
    function fitWall(screenCorners, aspectRatio) {
        const horizontalValues=screenCorners.map(function(point){return point[0];});
        const verticalValues=screenCorners.map(function(point){return point[1];});
        const horizontalMinimum=Math.min(...horizontalValues);
        const horizontalMaximum=Math.max(...horizontalValues);
        const verticalMinimum=Math.min(...verticalValues);
        const verticalMaximum=Math.max(...verticalValues);
        // A 1% border on each side, with uniform magnification and no stretching.
        const verticalScale=Math.min(1.96/(verticalMaximum-verticalMinimum),1.96*aspectRatio/(horizontalMaximum-horizontalMinimum));
        return [verticalScale/aspectRatio,verticalScale,
            -(horizontalMaximum+horizontalMinimum)*verticalScale/aspectRatio/2,
            -(verticalMaximum+verticalMinimum)*verticalScale/2];
    }
    function pixelUsage(screenCorners, framing, widthPixels, heightPixels) {
        const pixelCorners=screenCorners.map(function(point){return [
            (point[0]*framing[0]+framing[2]+1)*widthPixels/2,
            (point[1]*framing[1]+framing[3]+1)*heightPixels/2];});
        const horizontalValues=pixelCorners.map(function(point){return point[0];});
        const verticalValues=pixelCorners.map(function(point){return point[1];});
        let twiceArea=0;
        for(let cornerIndex=0;cornerIndex<4;cornerIndex++) {
            const nextCorner=pixelCorners[(cornerIndex+1)%4];
            twiceArea+=pixelCorners[cornerIndex][0]*nextCorner[1]-nextCorner[0]*pixelCorners[cornerIndex][1];
        }
        return {width:Math.max(...horizontalValues)-Math.min(...horizontalValues),
            height:Math.max(...verticalValues)-Math.min(...verticalValues),
            areaFraction:Math.abs(twiceArea)/2/(widthPixels*heightPixels),
            clipped:pixelCorners.some(function(point){return point[0]<0 || point[0]>widthPixels || point[1]<0 || point[1]>heightPixels;})};
    }
    return {fitWall:fitWall,pixelUsage:pixelUsage};
})();
if(typeof module!=="undefined")module.exports=BrickProjection;
