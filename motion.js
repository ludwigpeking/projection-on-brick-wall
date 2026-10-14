"use strict";

// Fixed-step motion is independent of playback history, so scrubbing is repeatable.
const BrickMotion = (function() {
    const stepSeconds = 1 / 60;
    const maximumGhostCount = 24;
    let cachedKey = "";
    let cachedTimeline;

    function randomFraction(seed) {
        const value = Math.sin(seed * 127.1 + 721.7) * 43758.5453;
        return value - Math.floor(value);
    }
    function smoothRamp(lowerBound, upperBound, value) {
        const fraction = Math.max(0,Math.min(1,(value-lowerBound)/(upperBound-lowerBound)));
        return fraction*fraction*(3-2*fraction);
    }
    function sectionsFor(durationSeconds,tempo) {
        const totalBeats=durationSeconds*tempo/60;
        const sections=[];
        let startBeat=0;
        let cycleIndex=0;
        let previousKind="";
        while(startBeat<totalBeats) {
            const kinds=["faces","flock","dance"];
            if(cycleIndex>0) {
                for(let position=2;position>0;position--) {
                    const otherPosition=Math.floor(randomFraction(cycleIndex*71+position*19)* (position+1));
                    [kinds[position],kinds[otherPosition]]=[kinds[otherPosition],kinds[position]];
                }
                if(kinds[0]===previousKind)[kinds[0],kinds[1]]=[kinds[1],kinds[0]];
            }
            for(let position=0;position<3 && startBeat<totalBeats;position++) {
                const sectionIndex=sections.length;
                const lengthBeats=cycleIndex===0 ? [16,24,16][position] : [12,16,20][Math.floor(randomFraction(sectionIndex+2501)*3)];
                const endBeat=Math.min(totalBeats,startBeat+lengthBeats);
                sections.push({kind:kinds[position],startBeat:startBeat,endBeat:endBeat,index:sectionIndex,variant:cycleIndex});
                previousKind=kinds[position];
                startBeat=endBeat;
            }
            cycleIndex++;
        }
        return sections;
    }
    function sceneAt(timeSeconds,durationSeconds,tempo) {
        const sections=sectionsFor(durationSeconds,tempo);
        const beatPosition=Math.max(0,Math.min(timeSeconds,durationSeconds))*tempo/60;
        const section=sections.find(function(candidate){return beatPosition<candidate.endBeat;}) || sections[sections.length-1];
        const localBeats=beatPosition-section.startBeat;
        const remainingBeats=section.endBeat-beatPosition;
        const entry=smoothRamp(0,section.kind==="flock" ? 2 : 0.8,localBeats);
        const exit=smoothRamp(0,0.65,remainingBeats);
        return {...section,localBeats:localBeats,localSeconds:localBeats*60/tempo,envelope:entry*exit};
    }
    function previewTime(kind,durationSeconds,tempo) {
        const section=sectionsFor(durationSeconds,tempo).find(function(candidate){return candidate.kind===kind;});
        return section ? (section.startBeat+4.22)*60/tempo : 0;
    }
    function faceAt(timeSeconds, durationSeconds, tempo, wallWidth, wallHeight, beatStrength) {
        const beatTime = timeSeconds * tempo / 60;
        const beatIndex = Math.floor(beatTime);
        const beatFraction = beatTime - beatIndex;
        const scene=sceneAt(timeSeconds,durationSeconds,tempo);
        const envelope = beatIndex >= 1 && timeSeconds<durationSeconds && scene.kind==="faces"
            ? smoothRamp(0,0.18,beatFraction) * (1-smoothRamp(0.27,0.96,beatFraction)) : 0;
        const scale = Math.min(wallWidth,wallHeight*0.7) * (0.12 + randomFraction(beatIndex+13)*0.13);
        const rotation = (randomFraction(beatIndex+53)-0.5)*2.4;
        const horizontalRadius = scale*(0.95*Math.abs(Math.cos(rotation))+1.5*Math.abs(Math.sin(rotation)));
        const verticalRadius = scale*(0.95*Math.abs(Math.sin(rotation))+1.5*Math.abs(Math.cos(rotation)));
        const horizontalRoom = Math.max(0,wallWidth/2-horizontalRadius*0.85);
        const verticalRoom = Math.max(0,wallHeight/2-verticalRadius*0.85);
        return {
            pose:[(randomFraction(beatIndex+101)*2-1)*horizontalRoom,wallHeight/2+(randomFraction(beatIndex+211)*2-1)*verticalRoom,scale,rotation],
            expression:[0.25+randomFraction(beatIndex+301)*0.19,0.13+randomFraction(beatIndex+411)*0.17,0.15+randomFraction(beatIndex+521)*0.20,0.21+randomFraction(beatIndex+631)*0.42],
            character:[0.8+randomFraction(beatIndex+741)*0.32,0.85+randomFraction(beatIndex+851)*0.35,(randomFraction(beatIndex+961)-0.5)*0.2,randomFraction(beatIndex+1071)],
            strength:envelope*(0.75+beatStrength*(0.2+randomFraction(beatIndex+1181)*0.7)),
            beatIndex:beatIndex
        };
    }
    function facesAt(timeSeconds, durationSeconds, tempo, wallWidth, wallHeight, beatStrength) {
        const beatDuration=60/tempo;
        const currentBeat=Math.floor(timeSeconds/beatDuration);
        const beatFraction=timeSeconds/beatDuration-currentBeat;
        const faceCount=1+Math.floor(randomFraction(currentBeat+1571)*4);
        const beatStrengthValue=faceAt(timeSeconds,durationSeconds,tempo,wallWidth,wallHeight,beatStrength).strength;
        const poses=new Float32Array(16);
        const expressions=new Float32Array(16);
        const characters=new Float32Array(16);
        for(let faceIndex=0;faceIndex<4;faceIndex++) {
            // Independent identity per face, while all envelopes follow the real current beat.
            const identityTime=(currentBeat+faceIndex*149+beatFraction)*beatDuration;
            const face=faceAt(identityTime,durationSeconds,tempo,wallWidth,wallHeight,beatStrength);
            poses.set(face.pose,faceIndex*4);
            expressions.set(face.expression,faceIndex*4);
            characters.set(face.character,faceIndex*4);
        }
        return {poses:poses,expressions:expressions,characters:characters,count:faceCount,strength:beatStrengthValue};
    }
    function buildTimeline(configuration) {
        const wallWidth=configuration.wallWidth;
        const wallHeight=configuration.wallHeight;
        const ghostCount=configuration.ghostCount;
        // Port of the supplied ghost.js / sketch.js, in wall meters and seconds.
        const metersPerSketchPixel=Math.min(wallWidth/800,wallHeight/1200);
        const sketchFramesPerSecond=15;
        const maximumSpeed=5*metersPerSketchPixel*sketchFramesPerSecond;
        const perceptionRadius=150*metersPerSketchPixel;
        const separationDistance=100*metersPerSketchPixel;
        const boundaryAcceleration=0.8*metersPerSketchPixel*sketchFramesPerSecond*sketchFramesPerSecond;
        const speedMultiplier=configuration.ghostSpeed ?? 3.5;
        const simulationDuration=configuration.duration*speedMultiplier;
        const frameCount=Math.ceil(simulationDuration/stepSeconds)+2;
        const frameStride=ghostCount*5;
        const frames=new Float32Array(frameCount*frameStride);
        const ghosts=[];
        const widths=[];
        for(let ghostIndex=0;ghostIndex<ghostCount;ghostIndex++) {
            // Size does not shrink the movement realm: both scenes use the full wall.
            const ghostWidth=Math.min(wallWidth*(0.14+randomFraction(ghostIndex+43)*0.10)*configuration.ghostScale,wallWidth*0.38,wallHeight*0.28);
            const horizontalRoom=wallWidth/2;
            const verticalRoom=wallHeight/2;
            const heading=randomFraction(ghostIndex+37)*Math.PI*2;
            const initialSpeed=maximumSpeed*(0.5+randomFraction(ghostIndex+71)*0.5);
            ghosts.push({
                horizontalPosition:(randomFraction(ghostIndex+101)*2-1)*horizontalRoom,
                verticalPosition:wallHeight/2+(randomFraction(ghostIndex+211)*2-1)*verticalRoom,
                horizontalVelocity:Math.sin(heading)*initialSpeed,
                verticalVelocity:Math.cos(heading)*initialSpeed,
                heading:-heading,
                turnAmount:0,
                poseIndex:0
            });
            widths.push(ghostWidth);
        }
        for(let frameIndex=0;frameIndex<frameCount;frameIndex++) {
            const elapsedSeconds=frameIndex*stepSeconds;
            for(let ghostIndex=0;ghostIndex<ghostCount;ghostIndex++) {
                const ghost=ghosts[ghostIndex];
                const frameOffset=frameIndex*frameStride+ghostIndex*5;
                frames[frameOffset]=ghost.horizontalPosition;
                frames[frameOffset+1]=ghost.verticalPosition;
                frames[frameOffset+2]=ghost.heading;
                frames[frameOffset+3]=ghost.turnAmount;
                frames[frameOffset+4]=ghost.poseIndex;
                let neighborCount=0;
                let neighborHorizontalPosition=0;
                let neighborVerticalPosition=0;
                let neighborHorizontalVelocity=0;
                let neighborVerticalVelocity=0;
                let horizontalSeparation=0;
                let verticalSeparation=0;
                for(let otherIndex=0;otherIndex<ghostCount;otherIndex++) {
                    if(ghostIndex===otherIndex)continue;
                    const otherGhost=ghosts[otherIndex];
                    const horizontalDifference=ghost.horizontalPosition-otherGhost.horizontalPosition;
                    const verticalDifference=ghost.verticalPosition-otherGhost.verticalPosition;
                    const distance=Math.max(0.001,Math.hypot(horizontalDifference,verticalDifference));
                    if(distance<separationDistance) {
                        horizontalSeparation+=horizontalDifference/(distance*distance);
                        verticalSeparation+=verticalDifference/(distance*distance);
                    }
                    if(distance<perceptionRadius) {
                        neighborCount++;
                        neighborHorizontalPosition-=horizontalDifference;
                        neighborVerticalPosition-=verticalDifference;
                        neighborHorizontalVelocity+=otherGhost.horizontalVelocity;
                        neighborVerticalVelocity+=otherGhost.verticalVelocity;
                    }
                }
                // Original setMag(maxSpeed), then weights 0.01 / 0.02 / 0.05.
                const cohesionMagnitude=Math.hypot(neighborHorizontalPosition,neighborVerticalPosition);
                const alignmentMagnitude=Math.hypot(neighborHorizontalVelocity,neighborVerticalVelocity);
                const separationMagnitude=Math.hypot(horizontalSeparation,verticalSeparation);
                const cohesionFactor=cohesionMagnitude>0 ? maximumSpeed*sketchFramesPerSecond*0.01/cohesionMagnitude : 0;
                const alignmentFactor=alignmentMagnitude>0 ? maximumSpeed*sketchFramesPerSecond*0.02/alignmentMagnitude : 0;
                const separationFactor=separationMagnitude>0 ? maximumSpeed*sketchFramesPerSecond*0.05/separationMagnitude : 0;
                let horizontalAcceleration=neighborHorizontalPosition*cohesionFactor+neighborHorizontalVelocity*alignmentFactor+horizontalSeparation*separationFactor;
                let verticalAcceleration=neighborVerticalPosition*cohesionFactor+neighborVerticalVelocity*alignmentFactor+verticalSeparation*separationFactor;
                // Neighbor interactions and wall boundaries alone steer the flock.
                const minimumHorizontal=-wallWidth/2;
                const maximumHorizontal=wallWidth/2;
                const minimumVertical=0;
                const maximumVertical=wallHeight;
                const turningDistance=150*metersPerSketchPixel;
                if(ghost.horizontalPosition<minimumHorizontal+turningDistance)horizontalAcceleration+=(minimumHorizontal+turningDistance-ghost.horizontalPosition)/turningDistance*boundaryAcceleration;
                else if(ghost.horizontalPosition>maximumHorizontal-turningDistance)horizontalAcceleration-=(ghost.horizontalPosition-maximumHorizontal+turningDistance)/turningDistance*boundaryAcceleration;
                if(ghost.verticalPosition<minimumVertical+turningDistance)verticalAcceleration+=(minimumVertical+turningDistance-ghost.verticalPosition)/turningDistance*boundaryAcceleration;
                else if(ghost.verticalPosition>maximumVertical-turningDistance)verticalAcceleration-=(ghost.verticalPosition-maximumVertical+turningDistance)/turningDistance*boundaryAcceleration;
                const previousSpeed=Math.hypot(ghost.horizontalVelocity,ghost.verticalVelocity);
                // Original p5 sketch uses downward-positive Y; wall coordinates use
                // upward-positive Y, so its signed perpendicular projection reverses.
                const steeringProjection=(horizontalAcceleration*ghost.verticalVelocity-verticalAcceleration*ghost.horizontalVelocity)/Math.max(previousSpeed,0.0001)/(metersPerSketchPixel*sketchFramesPerSecond*sketchFramesPerSecond);
                ghost.turnAmount=steeringProjection;
                const steeringMagnitude=Math.abs(steeringProjection);
                ghost.poseIndex=steeringMagnitude<0.05 ? 0 : steeringMagnitude<0.15 ? 1 : steeringMagnitude<0.3 ? 2 : 3;
                const accelerationMagnitude=Math.hypot(horizontalAcceleration,verticalAcceleration);
                const accelerationSketchMagnitude=accelerationMagnitude/(metersPerSketchPixel*sketchFramesPerSecond*sketchFramesPerSecond);
                const forwardAlignment=(horizontalAcceleration*ghost.horizontalVelocity+verticalAcceleration*ghost.verticalVelocity)/Math.max(accelerationMagnitude*previousSpeed,0.0001);
                if(steeringMagnitude<0.1 && accelerationSketchMagnitude>0.1) {
                    if(forwardAlignment < -0.7)ghost.poseIndex=7;
                    else if(forwardAlignment > 0.7)ghost.poseIndex=6;
                }
                // Original sequential flock/update order, with fixed-time integration.
                ghost.horizontalVelocity+=horizontalAcceleration*stepSeconds;
                ghost.verticalVelocity+=verticalAcceleration*stepSeconds;
                const speed=Math.hypot(ghost.horizontalVelocity,ghost.verticalVelocity);
                const speedFactor=Math.max(0.3*maximumSpeed,Math.min(1.2*maximumSpeed,speed))/Math.max(speed,0.001);
                ghost.horizontalVelocity*=speedFactor;
                ghost.verticalVelocity*=speedFactor;
                ghost.horizontalPosition+=ghost.horizontalVelocity*stepSeconds;
                ghost.verticalPosition+=ghost.verticalVelocity*stepSeconds;
                const horizontalLimit=wallWidth/2;
                // Reflect residual outward velocity if a soft steering turn reaches the realm edge.
                if(Math.abs(ghost.horizontalPosition)>horizontalLimit) {
                    const boundarySign=Math.sign(ghost.horizontalPosition);
                    ghost.horizontalPosition=boundarySign*horizontalLimit;
                    ghost.horizontalVelocity=-boundarySign*Math.abs(ghost.horizontalVelocity)*0.75;
                }
                if(ghost.verticalPosition<0 || ghost.verticalPosition>wallHeight) {
                    const lowerBoundary=ghost.verticalPosition<0;
                    ghost.verticalPosition=lowerBoundary?0:wallHeight;
                    ghost.verticalVelocity=(lowerBoundary?1:-1)*Math.abs(ghost.verticalVelocity)*0.75;
                }
                const desiredHeading=Math.atan2(-ghost.horizontalVelocity,ghost.verticalVelocity);
                const headingDifference=Math.atan2(Math.sin(desiredHeading-ghost.heading),Math.cos(desiredHeading-ghost.heading));
                const headingStep=Math.max(-stepSeconds*0.72,Math.min(stepSeconds*0.72,headingDifference*stepSeconds*1.4));
                ghost.heading+=headingStep;
            }
        }
        return {frames:frames,widths:widths,frameStride:frameStride,frameCount:frameCount};
    }
    function danceAt(timeSeconds,configuration,scene) {
        const tempo=configuration.tempo ?? 138;
        const beatPosition=timeSeconds*tempo/60;
        const layout=scene.variant%3;
        const columnCount=layout===1 ? 4 : 3;
        const rowCount=layout===2 ? 5 : layout===1 ? 3 : 4;
        const baseCount=columnCount*rowCount;
        const extraCount=(columnCount-1)*(rowCount-1);
        const count=baseCount+extraCount;
        const cellWidth=configuration.wallWidth/columnCount;
        const cellHeight=configuration.wallHeight/rowCount;
        const positions=new Float32Array(maximumGhostCount*4);
        const appearances=new Float32Array(maximumGhostCount*4);
        for(let ghostIndex=0;ghostIndex<count;ghostIndex++) {
            const offset=ghostIndex*4;
            const betweenRows=ghostIndex>=baseCount;
            const gridIndex=betweenRows ? ghostIndex-baseCount : ghostIndex;
            const rowIndex=Math.floor(gridIndex/(betweenRows ? columnCount-1 : columnCount));
            const columnIndex=gridIndex%(betweenRows ? columnCount-1 : columnCount);
            const phase=randomFraction(ghostIndex+scene.index*31+2801)*Math.PI*2;
            const sway=Math.sin(beatPosition*Math.PI+rowIndex*0.8+phase);
            const bob=Math.sin(beatPosition*Math.PI*2+columnIndex*0.7+phase);
            const pulsePosition=beatPosition+(betweenRows ? 0.5 : 0)+rowIndex*0.12;
            const pulseFraction=pulsePosition-Math.floor(pulsePosition);
            const pulse=smoothRamp(0,0.12,pulseFraction)*(1-smoothRamp(0.22,0.9,pulseFraction));
            // Interstitial rows rise and sink independently, on syncopated beats.
            const attendance=betweenRows ? smoothRamp(-0.35,0.55,Math.sin(scene.localBeats*Math.PI/2+phase)) : 0.72+0.28*Math.sin(scene.localBeats*Math.PI/4+phase)**2;
            const rowEntry=smoothRamp(0,0.9,scene.localBeats-rowIndex*0.14);
            const width=Math.min(cellWidth*0.90,cellHeight/1.5*0.90)*(betweenRows ? 0.80 : 1)*(0.82+0.28*randomFraction(ghostIndex+2999))*(1+0.09*pulse);
            positions[offset]=(columnIndex+(betweenRows ? 1 : 0.5))*cellWidth-configuration.wallWidth/2+cellWidth*0.08*sway;
            positions[offset+1]=configuration.wallHeight-(rowIndex+(betweenRows ? 1 : 0.5))*cellHeight+cellHeight*0.055*bob;
            positions[offset+2]=0.12*sway;
            positions[offset+3]=width;
            const depthVariation=0.85+0.45*randomFraction(ghostIndex+3101);
            // Independent multi-beat travel lets even the main rows nearly retract.
            // Apply it to the rhythmic pop too, so a recessed dancer stays low.
            const depthCycleBeats=3.5+2.5*randomFraction(ghostIndex+scene.index*43+3253);
            const depthCyclePosition=Math.sin(scene.localBeats*Math.PI*2/depthCycleBeats+phase);
            const depthTravelFactor=0.015+1.335*smoothRamp(-0.55,0.70,depthCyclePosition);
            appearances[offset]=scene.envelope*rowEntry*attendance*depthTravelFactor*(depthVariation+pulse*(configuration.flockBeatStrength ?? 0.8)*(1.0+randomFraction(ghostIndex+3187)));
            appearances[offset+1]=0;
            appearances[offset+2]=1;
            appearances[offset+3]=1;
        }
        return {positions:positions,appearances:appearances,count:count};
    }
    function flockAt(timeSeconds, configuration) {
        const scene=sceneAt(timeSeconds,configuration.duration,configuration.tempo ?? 138);
        if(scene.kind==="faces")return {positions:new Float32Array(maximumGhostCount*4),appearances:new Float32Array(maximumGhostCount*4),count:0};
        if(scene.kind==="dance")return danceAt(timeSeconds,configuration,scene);
        const movementConfiguration={wallWidth:configuration.wallWidth,wallHeight:configuration.wallHeight,ghostCount:configuration.ghostCount,ghostScale:configuration.ghostScale,ghostSpeed:configuration.ghostSpeed ?? 3.5,duration:configuration.duration};
        const configurationKey=JSON.stringify(movementConfiguration);
        if(configurationKey!==cachedKey) {cachedTimeline=buildTimeline(movementConfiguration);cachedKey=configurationKey;}
        const beatPosition=timeSeconds*(configuration.tempo ?? 138)/60;
        const beatIndex=Math.floor(beatPosition);
        const beatFraction=beatPosition-beatIndex;
        const beatEnvelope=smoothRamp(0,0.10,beatFraction)*(1-smoothRamp(0.15,0.85,beatFraction));
        const musicalAccent=beatIndex%4===0 ? 1.2 : beatIndex%2===1 ? 1.1 : 0.92;
        const framePosition=timeSeconds*(configuration.ghostSpeed ?? 3.5)/stepSeconds;
        const lowerFrame=Math.min(cachedTimeline.frameCount-2,Math.floor(framePosition));
        const interpolationAmount=framePosition-Math.floor(framePosition);
        const positions=new Float32Array(maximumGhostCount*4);
        const appearances=new Float32Array(maximumGhostCount*4);
        for(let ghostIndex=0;ghostIndex<configuration.ghostCount;ghostIndex++) {
            const frameOffset=lowerFrame*cachedTimeline.frameStride+ghostIndex*5;
            const ghostOffset=ghostIndex*4;
            for(let componentIndex=0;componentIndex<3;componentIndex++) {
                const previousValue=cachedTimeline.frames[frameOffset+componentIndex];
                const nextValue=cachedTimeline.frames[frameOffset+cachedTimeline.frameStride+componentIndex];
                positions[ghostOffset+componentIndex]=previousValue+(nextValue-previousValue)*interpolationAmount;
            }
            const sizePhase=randomFraction(ghostIndex+1301)*Math.PI*2;
            const sizePeriodSeconds=4+randomFraction(ghostIndex+1409)*4;
            const sizeMultiplier=0.90+0.18*Math.sin(timeSeconds*Math.PI*2/sizePeriodSeconds+sizePhase);
            const emergence=smoothRamp(0,1.5,scene.localBeats-ghostIndex*0.08)*scene.envelope;
            const depthPhase=randomFraction(ghostIndex+1511)*Math.PI*2;
            const depthMultiplier=0.95+0.45*Math.sin(timeSeconds*Math.PI*2/(4+randomFraction(ghostIndex+1601)*5)+depthPhase);
            const approachPeriodSeconds=5.5+randomFraction(ghostIndex+1709)*3;
            const approachPhaseSeconds=scene.localSeconds-2.0-ghostIndex*0.32;
            const approachDistanceSeconds=approachPhaseSeconds-Math.round(approachPhaseSeconds/approachPeriodSeconds)*approachPeriodSeconds;
            const approachEnvelope=ghostIndex%3===scene.index%3 ? Math.exp(-0.5*(approachDistanceSeconds/0.72)**2) : 0;
            const individualBeatStrength=(0.5+randomFraction(beatIndex*31+ghostIndex*149+1901)*0.6)*(configuration.flockBeatStrength ?? 0.8);
            const beatPulseStrength=beatEnvelope*musicalAccent*individualBeatStrength;
            // One shared envelope expands the silhouette and pushes bricks out.
            // Centers and steering stay independent of the rhythmic pop.
            const beatSizeMultiplier=1+0.42*beatPulseStrength;
            positions[ghostOffset+3]=cachedTimeline.widths[ghostIndex]*1.24*sizeMultiplier*(1+0.15*approachEnvelope)*beatSizeMultiplier;
            appearances[ghostOffset]=emergence*(depthMultiplier+3.2*approachEnvelope+2.6*beatPulseStrength);
            appearances[ghostOffset+1]=cachedTimeline.frames[frameOffset+4];
            appearances[ghostOffset+2]=0;
            appearances[ghostOffset+3]=appearances[ghostOffset+1]!==0 && cachedTimeline.frames[frameOffset+3]<=0 ? -1 : 1;
        }
        return {positions:positions,appearances:appearances,count:configuration.ghostCount};
    }
    return {faceAt:faceAt,facesAt:facesAt,flockAt:flockAt,sceneAt:sceneAt,sectionsFor:sectionsFor,previewTime:previewTime};
})();
if(typeof module!=="undefined")module.exports=BrickMotion;
