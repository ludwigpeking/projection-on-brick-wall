"use strict";

const previewCanvas = document.getElementById("preview");
const graphics = previewCanvas.getContext("webgl", {alpha:true, antialias:true, preserveDrawingBuffer:true});
const musicPlayer = document.getElementById("music-player");
const musicOptions = {
    surf: {tempo:138, bars:56, duration:56 * 240 / 138},
    doom: {tempo:88, bars:40, duration:40 * 240 / 88},
    industrial: {tempo:120, bars:48, duration:96}
};
const settings = {
    "viewer-angle":30, "projector-angle":0, "relief-depth":0.55,
    "beat-response":0.38, "flock-count":8, "ghost-scale":1.55, "ghost-softness":0.8, "ghost-speed":3.5, "flock-beat-response":0.8, "ambient":0.2,
    "wall-width":8, "wall-height":12, "columns":36, "rows":160,
    "bond-offset":0, "viewer-distance":18, "viewer-height":1.7,
    "projector-distance":18, "projector-height":2, "throw-ratio":0.7
};
let selectedMusic = "surf";
let displayMode = "photo";
let currentSeconds = 4.22 * 60 / 138;
let vertexCount = 0;
let drawRequested = true;
let rendererReady = false;
let exportInProgress = false;
// Keep the left edge beyond the neighboring building's protruding ledge.
const defaultPhotoCorners = [[150,149],[484,106],[491,639],[150,639]];
let photoCorners = defaultPhotoCorners.map(function(corner){return corner.slice();});
let photographMatrix;
let draggingCorner = -1;
let lastDrawMilliseconds = 0;
const photoWidth = 581;
const photoHeight = 667;
const wallPhotograph = new Image();
wallPhotograph.src = "assets/wall-reference.png";
const photographBackground = document.createElement("img");
photographBackground.src = wallPhotograph.src;
photographBackground.alt = "";
photographBackground.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:brightness(.38);pointer-events:none;display:none";
previewCanvas.before(photographBackground);
previewCanvas.style.position = "relative";

const vertexSource = `
precision highp float;
attribute vec3 cornerPosition;
attribute vec2 brickCenter;
attribute vec3 faceNormal;
uniform float reliefDepth;
uniform float flockCount;
uniform float flockSoftness;
uniform vec4 facePoses[4];
uniform vec4 faceExpressions[4];
uniform vec4 faceCharacters[4];
uniform float faceCount;
uniform float faceStrength;
uniform vec4 ghostPositions[24];
uniform vec4 ghostAppearances[24];
uniform vec2 wallDimensions;
uniform vec2 brickDimensions;
uniform vec3 viewerPosition;
uniform vec3 cameraPosition;
uniform vec3 cameraRight;
uniform vec3 cameraUp;
uniform vec3 cameraForward;
uniform vec4 framing;
uniform float displayMode;
uniform mat3 photographMatrix;
uniform vec2 photographFit;
uniform sampler2D ghostAtlas;
uniform sampler2D ghostFeatherAtlas;
varying vec2 projectedWallCoordinate;
varying vec2 textureCoordinate;
varying float brickFrontFace;
varying float brickDisplacement;
varying float cavityAmount;
varying float extrusionFraction;
varying float brickVariation;
varying vec2 brickCoordinate;

float gaussian(vec2 coordinate, vec2 radius) {
    vec2 scaledCoordinate = coordinate / radius;
    return exp(-dot(scaledCoordinate, scaledCoordinate) * 2.0);
}
vec2 faceRelief(vec2 position, vec4 facePose, vec4 faceExpression, vec4 faceCharacter) {
    float cosineAngle = cos(facePose.w);
    float sineAngle = sin(facePose.w);
    vec2 localPosition = mat2(cosineAngle,-sineAngle,sineAngle,cosineAngle) * (position-facePose.xy) / facePose.z;
    localPosition.x /= faceCharacter.x;
    localPosition.y /= faceCharacter.y;
    float head = gaussian(localPosition, vec2(0.95,1.5));
    float leftEye = gaussian(localPosition - vec2(-faceExpression.x,0.25+faceCharacter.z), vec2(0.23,faceExpression.y));
    float rightEye = gaussian(localPosition - vec2(faceExpression.x,0.25-faceCharacter.z), vec2(0.23,faceExpression.y*(0.8+faceCharacter.w*0.4)));
    float mouth = gaussian(localPosition - vec2(faceCharacter.z,-0.48), vec2(faceExpression.z,faceExpression.w));
    float nose = gaussian(localPosition - vec2(0.0,0.02), vec2(0.15+faceCharacter.w*0.1,0.42));
    float brows = gaussian(localPosition - vec2(0.0,0.48), vec2(0.76,0.19));
    float cavity = clamp((leftEye + rightEye + mouth) * 1.4, 0.0, 1.0);
    float height = max(0.0, head * 0.7 + nose * 0.5 + brows * 0.2 - cavity * 0.95);
    return vec2(height * faceStrength,cavity);
}
vec2 reliefAt(vec2 position) {
    vec2 relief = vec2(0.0);
    if (faceStrength > 0.0001) {
        for (int faceIndex=0; faceIndex<4; faceIndex++) {
            if (float(faceIndex)>=faceCount) break;
            vec2 faceShape = faceRelief(position,facePoses[faceIndex],faceExpressions[faceIndex],faceCharacters[faceIndex]);
            if(faceShape.x>relief.x)relief=faceShape;
        }
    }
        for (int ghostIndex=0; ghostIndex<24; ghostIndex++) {
            if (float(ghostIndex) >= flockCount) break;
            vec4 ghostPosition = ghostPositions[ghostIndex];
            vec4 ghostAppearance = ghostAppearances[ghostIndex];
            if (ghostAppearance.x < 0.0001) continue;
            vec2 center = ghostPosition.xy;
            float rotationAngle = ghostPosition.z;
            float cosineAngle = cos(rotationAngle);
            float sineAngle = sin(rotationAngle);
            vec2 localPosition = position - center;
            localPosition = mat2(cosineAngle,-sineAngle,sineAngle,cosineAngle) * localPosition;
            float ghostWidth = ghostPosition.w;
            vec2 ghostCoordinate = localPosition / vec2(ghostWidth,ghostWidth * 1.5) + 0.5;
            if (ghostCoordinate.x > 0.0 && ghostCoordinate.x < 1.0 && ghostCoordinate.y > 0.0 && ghostCoordinate.y < 1.0) {
                vec2 forwardGhostCoordinate=ghostCoordinate;
                if (ghostAppearance.w < 0.0) ghostCoordinate.x = 1.0-ghostCoordinate.x;
                float poseIndex = ghostAppearance.y;
                float silhouette = texture2D(ghostAtlas,vec2((ghostCoordinate.x + poseIndex) / 8.0,ghostCoordinate.y)).a;
                float nextSilhouette = texture2D(ghostAtlas,vec2(forwardGhostCoordinate.x / 8.0,forwardGhostCoordinate.y)).a;
                silhouette = mix(silhouette,nextSilhouette,ghostAppearance.z);
                float featheredSilhouette = texture2D(ghostFeatherAtlas,vec2((ghostCoordinate.x + poseIndex) / 8.0,ghostCoordinate.y)).a;
                float nextFeatheredSilhouette = texture2D(ghostFeatherAtlas,vec2(forwardGhostCoordinate.x / 8.0,forwardGhostCoordinate.y)).a;
                featheredSilhouette = mix(featheredSilhouette,nextFeatheredSilhouette,ghostAppearance.z);
                // Broad height falloff raises neighboring bricks gradually before the body arrives.
                // Preserve interior eyes/mouth while letting the outer contour dissolve into the wall.
                float interiorCavity = smoothstep(0.22,0.48,featheredSilhouette) * (1.0-smoothstep(0.04,0.16,silhouette));
                // Keep the Gaussian tail against the wall, then steepen the rise
                // into the body without introducing a hard step or a flat plateau.
                vec2 gaussianCoordinate = (ghostCoordinate-vec2(0.5,0.52))/vec2(0.25,0.35);
                float gaussianProfile = exp(-0.5*dot(gaussianCoordinate,gaussianCoordinate));
                vec2 upperCoreCoordinate=(ghostCoordinate-vec2(0.48,0.66))/vec2(0.11,0.14);
                vec2 lowerCoreCoordinate=(ghostCoordinate-vec2(0.55,0.43))/vec2(0.13,0.11);
                float upperCoreBump=0.75*exp(-0.5*dot(upperCoreCoordinate,upperCoreCoordinate));
                float lowerCoreBump=0.45*exp(-0.5*dot(lowerCoreCoordinate,lowerCoreCoordinate));
                float coreHeightMultiplier=1.0+upperCoreBump+lowerCoreBump;
                vec2 distanceToSupportEdge = min(ghostCoordinate,vec2(1.0)-ghostCoordinate);
                float supportTaper = smoothstep(0.0,0.12,distanceToSupportEdge.x)*smoothstep(0.0,0.12,distanceToSupportEdge.y);
                // Original low-alpha eyes and mouth stay recessed even when broad
                // feathering would otherwise fill them back in.
                float ghostBody = featheredSilhouette*smoothstep(0.04,0.40,silhouette)*(1.0-interiorCavity*0.85);
                float lowReliefProfile = ghostBody*gaussianProfile*supportTaper;
                float raisedBodyWeight = smoothstep(0.08,0.45,lowReliefProfile);
                float steepReliefProfile = lowReliefProfile*(1.0+1.2*raisedBodyWeight);
                const float flockHeightMultiplier = 0.20;
                float ghostHeight = flockHeightMultiplier*steepReliefProfile*coreHeightMultiplier*ghostAppearance.x*mix(1.0,0.65,flockSoftness);
                if (ghostHeight > relief.x) {
                    relief.x = ghostHeight;
                    relief.y = interiorCavity;

                }
            }
        }
    relief.x *= reliefDepth;
    return relief;
}
void main() {
    vec2 relief=reliefAt(brickCenter);
    brickDisplacement=relief.x;
    cavityAmount=relief.y;
    extrusionFraction=cornerPosition.z;
    vec3 worldPosition = vec3(brickCenter + cornerPosition.xy * brickDimensions, cornerPosition.z * (0.009 + relief.x));
    brickFrontFace = faceNormal.z;
    brickCoordinate = cornerPosition.xy;
    brickVariation = fract(sin(dot(brickCenter, vec2(12.9898,78.233))) * 43758.5453);
    vec2 wallCoordinate = vec2(worldPosition.x / wallDimensions.x + 0.5, worldPosition.y / wallDimensions.y);
    vec3 photographCoordinate = photographMatrix * vec3(wallCoordinate,1.0);
    textureCoordinate = photographCoordinate.xy / photographCoordinate.z;
    float virtualViewerDistance = length(worldPosition - viewerPosition);
    if (displayMode > 0.5) {
        // Intersect the sweet-spot viewer's ray with the physical z=0 wall.
        float rayAmount = viewerPosition.z / (viewerPosition.z - worldPosition.z);
        worldPosition = viewerPosition + (worldPosition - viewerPosition) * rayAmount;
    }
    projectedWallCoordinate=vec2(worldPosition.x/wallDimensions.x+0.5,worldPosition.y/wallDimensions.y);
    vec3 relativePosition = worldPosition - cameraPosition;
    float forwardDistance = dot(relativePosition,cameraForward);
    vec2 screenPosition = vec2(dot(relativePosition,cameraRight),dot(relativePosition,cameraUp)) / forwardDistance;
    screenPosition = screenPosition * framing.xy + framing.zw;
    if (displayMode > 0.5 && displayMode < 1.5) {
        vec2 mappedWallCoordinate = vec2(worldPosition.x / wallDimensions.x + 0.5, worldPosition.y / wallDimensions.y);
        vec3 imageCoordinate = photographMatrix * vec3(mappedWallCoordinate,1.0);
        screenPosition = (imageCoordinate.xy / imageCoordinate.z * 2.0 - 1.0) * photographFit;
    }
    // Even after flattening onto the wall, visibility belongs to the virtual viewer.
    float depthCoordinate = displayMode > 0.5 ? (1.0002 - 0.20002 / virtualViewerDistance) * forwardDistance : 1.0002 * forwardDistance - 0.20002;
    gl_Position = vec4(screenPosition * forwardDistance,depthCoordinate,forwardDistance);
}
`;

const fragmentSource = `
precision highp float;
uniform sampler2D wallTexture;
uniform float ambientVisibility;
uniform float displayMode;
uniform float showGrid;
uniform float reliefDepth;
uniform float flockSoftness;
varying vec2 projectedWallCoordinate;
varying vec2 textureCoordinate;
varying float brickFrontFace;
varying float brickDisplacement;
varying float cavityAmount;
varying float extrusionFraction;
varying float brickVariation;
varying vec2 brickCoordinate;
void main() {
    // Clip the final displaced projection, not just the original brick centers.
    // This prevents raised bricks from spilling beyond the registered wall.
    float projectionBoundaryFactor=1.0;
    if(displayMode>0.5) {
        vec2 boundaryDistance=min(projectedWallCoordinate,vec2(1.0)-projectedWallCoordinate);
        float nearestBoundaryDistance=min(boundaryDistance.x,boundaryDistance.y);
        if(nearestBoundaryDistance<=0.005)discard;
        projectionBoundaryFactor=smoothstep(0.005,0.012,nearestBoundaryDistance);
    }
    vec3 photographedColor = texture2D(wallTexture,textureCoordinate).rgb;
    vec3 stoneColor = mix(photographedColor,vec3(0.49,0.34,0.23),0.10);
    stoneColor *= 0.83 + brickVariation * 0.32;
    // Light output describes relief, rather than filling its silhouette.
    // The smooth response suppresses shallow Gaussian tails without a cutoff.
    const float brightnessReferenceDepth=0.10;
    float squaredDisplacement=brickDisplacement*brickDisplacement;
    float reliefBrightness=squaredDisplacement/(squaredDisplacement+brightnessReferenceDepth*brightnessReferenceDepth);
    // Symmetric mortar creases and dark extrusion roots suggest contact shadow.
    // These depend on brick geometry, with no directional spotlight.
    vec2 distanceToBrickEdge=vec2(0.48,0.44)-abs(brickCoordinate);
    float frontCreaseShade=mix(0.56,1.0,smoothstep(0.0,0.065,min(distanceToBrickEdge.x,distanceToBrickEdge.y)));
    float sideContactShade=mix(0.16,0.58,smoothstep(0.0,0.9,extrusionFraction));
    float brickShade=mix(sideContactShade,frontCreaseShade,brickFrontFace);
    float cavityShade=1.0-0.88*clamp(cavityAmount,0.0,1.0);
    float emittedLight=1.65*reliefBrightness*brickShade*cavityShade;
    vec3 finalColor=stoneColor*emittedLight;
    if(displayMode<0.5)finalColor=stoneColor*(0.22*brickShade+0.78*emittedLight);
    if (showGrid > 0.5) {
        float border = step(0.42,max(abs(brickCoordinate.x),abs(brickCoordinate.y)));
        finalColor = mix(finalColor,vec3(0.8,0.51,0.23),border * 0.75);
    }
    // Alpha stays opaque: softness comes from displacement and emitted light,
    // not a transparent ghost sprite. Zero displacement emits exactly black.
    gl_FragColor = vec4(finalColor*projectionBoundaryFactor,1.0);
}
`;

function compileShader(shaderType, shaderSource) {
    const shader = graphics.createShader(shaderType);
    graphics.shaderSource(shader,shaderSource);
    graphics.compileShader(shader);
    if (!graphics.getShaderParameter(shader,graphics.COMPILE_STATUS)) throw new Error(graphics.getShaderInfoLog(shader));
    return shader;
}
let shaderProgram;
let uniformLocations = {};
let masonryBuffer;
function bindMasonryAttributes() {
    graphics.bindBuffer(graphics.ARRAY_BUFFER,masonryBuffer);
    for(const attribute of [["cornerPosition",3,0],["brickCenter",2,12],["faceNormal",3,20]]) {
        const location=graphics.getAttribLocation(shaderProgram,attribute[0]);
        if(location<0)continue;
        graphics.enableVertexAttribArray(location);
        graphics.vertexAttribPointer(location,attribute[1],graphics.FLOAT,false,32,attribute[2]);
    }
}
function loadImage(imagePath) {
    return new Promise(function(resolve,reject) {
        const loadedImage = new Image();
        loadedImage.onload = function() {resolve(loadedImage);};
        loadedImage.onerror = function() {reject(new Error("Could not load " + imagePath));};
        loadedImage.src = imagePath;
    });
}
function createTexture(sourceImage, textureUnit) {
    const texture = graphics.createTexture();
    graphics.activeTexture(graphics.TEXTURE0 + textureUnit);
    graphics.bindTexture(graphics.TEXTURE_2D,texture);
    graphics.pixelStorei(graphics.UNPACK_FLIP_Y_WEBGL,true);
    graphics.texImage2D(graphics.TEXTURE_2D,0,graphics.RGBA,graphics.RGBA,graphics.UNSIGNED_BYTE,sourceImage);
    graphics.texParameteri(graphics.TEXTURE_2D,graphics.TEXTURE_MIN_FILTER,graphics.LINEAR);
    graphics.texParameteri(graphics.TEXTURE_2D,graphics.TEXTURE_MAG_FILTER,graphics.LINEAR);
    graphics.texParameteri(graphics.TEXTURE_2D,graphics.TEXTURE_WRAP_S,graphics.CLAMP_TO_EDGE);
    graphics.texParameteri(graphics.TEXTURE_2D,graphics.TEXTURE_WRAP_T,graphics.CLAMP_TO_EDGE);
    return texture;
}
function rebuildMasonry() {
    const vertices = [];
    const faces = [
        {normal:[0,0,1], corners:[[-0.48,-0.44,1],[0.48,-0.44,1],[0.48,0.44,1],[-0.48,0.44,1]]},
        {normal:[-1,0,0], corners:[[-0.48,-0.44,0],[-0.48,-0.44,1],[-0.48,0.44,1],[-0.48,0.44,0]]},
        {normal:[1,0,0], corners:[[0.48,-0.44,1],[0.48,-0.44,0],[0.48,0.44,0],[0.48,0.44,1]]},
        {normal:[0,1,0], corners:[[-0.48,0.44,1],[0.48,0.44,1],[0.48,0.44,0],[-0.48,0.44,0]]},
        {normal:[0,-1,0], corners:[[-0.48,-0.44,0],[0.48,-0.44,0],[0.48,-0.44,1],[-0.48,-0.44,1]]}
    ];
    const brickWidth = settings["wall-width"] / settings.columns;
    const brickHeight = settings["wall-height"] / settings.rows;
    for (let rowIndex = 0; rowIndex < settings.rows; rowIndex++) {
        for (let columnIndex = -1; columnIndex <= settings.columns; columnIndex++) {
            const centerHorizontal = (columnIndex + 0.5 + (rowIndex % 2) * 0.5 + settings["bond-offset"]) * brickWidth - settings["wall-width"] / 2;
            if (centerHorizontal < -settings["wall-width"] / 2 || centerHorizontal > settings["wall-width"] / 2) continue;
            const centerVertical = (rowIndex + 0.5) * brickHeight;
            for (const face of faces) {
                for (const cornerIndex of [0,1,2,0,2,3]) {
                    vertices.push(...face.corners[cornerIndex],centerHorizontal,centerVertical,...face.normal);
                }
            }
        }
    }
    vertexCount = vertices.length / 8;
    graphics.bindBuffer(graphics.ARRAY_BUFFER,masonryBuffer);
    graphics.bufferData(graphics.ARRAY_BUFFER,new Float32Array(vertices),graphics.STATIC_DRAW);
    const attributes = [["cornerPosition",3,0],["brickCenter",2,12],["faceNormal",3,20]];
    for (const attribute of attributes) {
        const location = graphics.getAttribLocation(shaderProgram,attribute[0]);
        graphics.enableVertexAttribArray(location);
        graphics.vertexAttribPointer(location,attribute[1],graphics.FLOAT,false,32,attribute[2]);
    }
    drawRequested = true;
}
function normalizeVector(vector) {
    const vectorLength = Math.hypot(...vector);
    return vector.map(function(component) {return component / vectorLength;});
}
function crossProduct(firstVector, secondVector) {
    return [firstVector[1]*secondVector[2]-firstVector[2]*secondVector[1],firstVector[2]*secondVector[0]-firstVector[0]*secondVector[2],firstVector[0]*secondVector[1]-firstVector[1]*secondVector[0]];
}
function dotProduct(firstVector, secondVector) {
    return firstVector.reduce(function(total,component,index) {return total + component * secondVector[index];},0);
}
function cameraFor(prefix) {
    const angleRadians = settings[prefix + "-angle"] * Math.PI / 180;
    const position = [Math.sin(angleRadians) * settings[prefix + "-distance"],settings[prefix + "-height"],Math.cos(angleRadians) * settings[prefix + "-distance"]];
    const forward = normalizeVector([-position[0],settings["wall-height"] / 2 - position[1],-position[2]]);
    const right = normalizeVector(crossProduct(forward,[0,1,0]));
    const up = crossProduct(right,forward);
    return {position:position, forward:forward, right:right, up:up};
}
function cameraScreenPoint(position, camera) {
    const relativePosition = position.map(function(component,index) {return component - camera.position[index];});
    const distanceForward = dotProduct(relativePosition,camera.forward);
    return [dotProduct(relativePosition,camera.right) / distanceForward,dotProduct(relativePosition,camera.up) / distanceForward];
}
function audienceFraming(camera, aspectRatio) {
    const screenCorners = [];
    for (const horizontalPosition of [-settings["wall-width"]/2,settings["wall-width"]/2]) {
        for (const verticalPosition of [0,settings["wall-height"]]) screenCorners.push(cameraScreenPoint([horizontalPosition,verticalPosition,0],camera));
    }
    const horizontalCoordinates = screenCorners.map(function(point) {return point[0];});
    const verticalCoordinates = screenCorners.map(function(point) {return point[1];});
    const horizontalMinimum = Math.min(...horizontalCoordinates);
    const horizontalMaximum = Math.max(...horizontalCoordinates);
    const verticalMinimum = Math.min(...verticalCoordinates);
    const verticalMaximum = Math.max(...verticalCoordinates);
    const verticalScale = Math.min(1.68 / (verticalMaximum - verticalMinimum),1.68 * aspectRatio / (horizontalMaximum - horizontalMinimum));
    return [verticalScale / aspectRatio,verticalScale,-(horizontalMaximum + horizontalMinimum) * verticalScale / aspectRatio / 2,-(verticalMaximum + verticalMinimum) * verticalScale / 2];
}
function projectorOutputDimensions() {
    const longEdgePixels=Number(document.getElementById("projector-resolution").value);
    const portrait=document.getElementById("projector-orientation").value==="portrait";
    const shortEdgePixels=longEdgePixels===3840 ? 2160 : 1080;
    return {width:portrait ? shortEdgePixels : longEdgePixels,height:portrait ? longEdgePixels : shortEdgePixels};
}
function projectorWallCorners(camera) {
    const halfWidth=settings["wall-width"]/2;
    return [[-halfWidth,0,0],[halfWidth,0,0],[halfWidth,settings["wall-height"],0],[-halfWidth,settings["wall-height"],0]].map(function(point){return cameraScreenPoint(point,camera);});
}
function projectorFraming(camera, aspectRatio) {
    if(document.getElementById("projector-framing").value==="fit")return BrickProjection.fitWall(projectorWallCorners(camera),aspectRatio);
    const horizontalScale=2*settings["throw-ratio"]/Math.min(1,aspectRatio);
    return [horizontalScale,horizontalScale*aspectRatio,0,0];
}
function updateProjectorOutput() {
    const output=projectorOutputDimensions();
    const aspectRatio=output.width/output.height;
    const stage=document.getElementById("stage");
    stage.classList.toggle("projector-output",displayMode==="projector");
    stage.style.setProperty("--feed-aspect",String(aspectRatio));
    document.getElementById("projector-output-controls").hidden=displayMode!=="projector";
    const camera=cameraFor("projector");
    const usage=BrickProjection.pixelUsage(projectorWallCorners(camera),projectorFraming(camera,aspectRatio),output.width,output.height);
    document.getElementById("projector-pixel-readout").textContent=output.width+" × "+output.height+" output · Wall footprint "+Math.round(usage.width)+" × "+Math.round(usage.height)+" px · "+Math.round(usage.areaFraction*100)+"% of raster area"+(usage.clipped?" · wall clipped":"");
}
function updatePhotographMatrix() {
    const sourceCorners = [[0,1],[1,1],[1,0],[0,0]];
    const equationRows = [];
    for (let cornerIndex=0; cornerIndex<4; cornerIndex++) {
        const [sourceHorizontal,sourceVertical] = sourceCorners[cornerIndex];
        const destinationHorizontal = photoCorners[cornerIndex][0] / photoWidth;
        const destinationVertical = 1 - photoCorners[cornerIndex][1] / photoHeight;
        equationRows.push([sourceHorizontal,sourceVertical,1,0,0,0,-destinationHorizontal*sourceHorizontal,-destinationHorizontal*sourceVertical,destinationHorizontal]);
        equationRows.push([0,0,0,sourceHorizontal,sourceVertical,1,-destinationVertical*sourceHorizontal,-destinationVertical*sourceVertical,destinationVertical]);
    }
    for (let pivotIndex=0; pivotIndex<8; pivotIndex++) {
        let largestRow = pivotIndex;
        for (let rowIndex=pivotIndex+1; rowIndex<8; rowIndex++) if (Math.abs(equationRows[rowIndex][pivotIndex]) > Math.abs(equationRows[largestRow][pivotIndex])) largestRow = rowIndex;
        [equationRows[pivotIndex],equationRows[largestRow]] = [equationRows[largestRow],equationRows[pivotIndex]];
        const pivotValue = equationRows[pivotIndex][pivotIndex];
        if (Math.abs(pivotValue)<1e-10) return;
        for (let columnIndex=pivotIndex; columnIndex<=8; columnIndex++) equationRows[pivotIndex][columnIndex] /= pivotValue;
        for (let rowIndex=0; rowIndex<8; rowIndex++) {
            if (rowIndex===pivotIndex) continue;
            const eliminationFactor = equationRows[rowIndex][pivotIndex];
            for (let columnIndex=pivotIndex; columnIndex<=8; columnIndex++) equationRows[rowIndex][columnIndex] -= eliminationFactor * equationRows[pivotIndex][columnIndex];
        }
    }
    const coefficients = equationRows.map(function(row) {return row[8];});
    photographMatrix = new Float32Array([coefficients[0],coefficients[3],coefficients[6],coefficients[1],coefficients[4],coefficients[7],coefficients[2],coefficients[5],1]);
    drawRequested = true;
}
function setUniform(name, value) {
    if (uniformLocations[name] == null) return;
    if (typeof value === "number") graphics.uniform1f(uniformLocations[name],value);
    else if (value.length === 96 || value.length === 16) graphics.uniform4fv(uniformLocations[name],value);
    else if (value.length === 2) graphics.uniform2fv(uniformLocations[name],value);
    else if (value.length === 3) graphics.uniform3fv(uniformLocations[name],value);
    else if (value.length === 4) graphics.uniform4fv(uniformLocations[name],value);
    else graphics.uniformMatrix3fv(uniformLocations[name],false,value);
}
function renderFrame() {
    if (!rendererReady) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1,1.5);
    const output=projectorOutputDimensions();
    const canvasWidth = displayMode==="projector" ? output.width : Math.round(previewCanvas.clientWidth * pixelRatio);
    const canvasHeight = displayMode==="projector" ? output.height : Math.round(previewCanvas.clientHeight * pixelRatio);
    if (previewCanvas.width !== canvasWidth || previewCanvas.height !== canvasHeight) {previewCanvas.width=canvasWidth;previewCanvas.height=canvasHeight;}
    graphics.viewport(0,0,canvasWidth,canvasHeight);
    graphics.useProgram(shaderProgram);
    bindMasonryAttributes();
    graphics.enable(graphics.DEPTH_TEST);
    const viewportAspect = canvasWidth / canvasHeight;
    const viewerCamera = cameraFor("viewer");
    const renderCamera = displayMode === "projector" ? cameraFor("projector") : viewerCamera;
    const frameSettings = displayMode === "projector" ? projectorFraming(renderCamera,viewportAspect) : audienceFraming(renderCamera,viewportAspect);
    const imageScale = Math.min(canvasWidth/photoWidth,canvasHeight/photoHeight);
    const faceMotion=BrickMotion.facesAt(currentSeconds,musicOptions[selectedMusic].duration,musicOptions[selectedMusic].tempo,settings["wall-width"],settings["wall-height"],settings["beat-response"]);
    const flockMotion=BrickMotion.flockAt(currentSeconds,{wallWidth:settings["wall-width"],wallHeight:settings["wall-height"],ghostCount:settings["flock-count"],ghostScale:settings["ghost-scale"],ghostSpeed:settings["ghost-speed"],flockBeatStrength:settings["flock-beat-response"],tempo:musicOptions[selectedMusic].tempo,duration:musicOptions[selectedMusic].duration});
    const uniformValues = {
        reliefDepth:settings["relief-depth"], flockCount:flockMotion.count,
        flockSoftness:settings["ghost-softness"],
        facePoses:faceMotion.poses,faceExpressions:faceMotion.expressions,faceCharacters:faceMotion.characters,faceCount:faceMotion.count,faceStrength:faceMotion.strength,
        ghostPositions:flockMotion.positions,ghostAppearances:flockMotion.appearances,
        wallDimensions:[settings["wall-width"],settings["wall-height"]], brickDimensions:[settings["wall-width"]/settings.columns,settings["wall-height"]/settings.rows],
        viewerPosition:viewerCamera.position, cameraPosition:renderCamera.position,
        cameraRight:renderCamera.right, cameraUp:renderCamera.up, cameraForward:renderCamera.forward,
        framing:frameSettings, displayMode:displayMode === "audience" ? 0 : (displayMode === "photo" ? 1 : 2),
        photographMatrix:photographMatrix, photographFit:[photoWidth*imageScale/canvasWidth,photoHeight*imageScale/canvasHeight],
        ambientVisibility:settings.ambient, showGrid:document.getElementById("show-grid").checked ? 1 : 0
    };
    for (const [uniformName,uniformValue] of Object.entries(uniformValues)) setUniform(uniformName,uniformValue);
    graphics.bindFramebuffer(graphics.FRAMEBUFFER,null);
    if(displayMode === "audience")graphics.clearColor(0.025,0.032,0.034,1);
    else graphics.clearColor(0,0,0,1);
    graphics.clear(graphics.COLOR_BUFFER_BIT | graphics.DEPTH_BUFFER_BIT);
    graphics.drawArrays(graphics.TRIANGLES,0,vertexCount);
    updateTransport();
    updateCornerHandles();
}
function formatTime(seconds) {return String(Math.floor(seconds/60)).padStart(2,"0") + ":" + String(Math.floor(seconds%60)).padStart(2,"0");}
function updateTransport() {
    const progress = currentSeconds / musicOptions[selectedMusic].duration;
    document.getElementById("time-label").textContent = formatTime(currentSeconds) + " / " + formatTime(musicOptions[selectedMusic].duration);
    document.getElementById("timeline").value = currentSeconds;
    const scene=BrickMotion.sceneAt(currentSeconds,musicOptions[selectedMusic].duration,musicOptions[selectedMusic].tempo);
    const sceneNames={faces:"Beat faces",flock:"Flying brick flock",dance:"Dancing rows + guests"};
    document.getElementById("scene-label").textContent=String(scene.index+1).padStart(2,"0")+" / "+sceneNames[scene.kind]+" · shuffled loop";
    document.querySelectorAll("[data-scene]").forEach(function(button){button.classList.toggle("active",button.dataset.scene===scene.kind);});
    document.getElementById("beat-light").style.opacity = String(0.25 + 0.75 * Math.exp(-(currentSeconds * musicOptions[selectedMusic].tempo/60%1)*8));
}
function requestDraw() {drawRequested=true;}
function animationLoop(timestampMilliseconds) {
    if(exportInProgress){requestAnimationFrame(animationLoop);return;}
    if (!musicPlayer.paused) {currentSeconds=musicPlayer.currentTime;drawRequested=true;}
    if (drawRequested && timestampMilliseconds-lastDrawMilliseconds>30) {renderFrame();drawRequested=false;lastDrawMilliseconds=timestampMilliseconds;}
    requestAnimationFrame(animationLoop);
}
function seek(seconds) {
    currentSeconds = Math.max(0,Math.min(seconds,musicOptions[selectedMusic].duration));
    musicPlayer.currentTime = currentSeconds;
    requestDraw();
}
async function togglePlayback() {
    if (musicPlayer.paused) {
        if (currentSeconds >= musicOptions[selectedMusic].duration-0.1) seek(0);
        musicPlayer.currentTime = currentSeconds;
        try {await musicPlayer.play();} catch (error) {showError("Audio could not start. Press Play again after the soundtrack loads. " + error.message);}
    } else musicPlayer.pause();
}
function updatePlayButton() {document.getElementById("play").textContent = musicPlayer.paused ? "▶ Play with music" : "Ⅱ Pause";}
function selectMusic(musicKey) {
    const progress = currentSeconds/musicOptions[selectedMusic].duration;
    const wasPlaying = !musicPlayer.paused;
    musicPlayer.pause();
    selectedMusic=musicKey;
    currentSeconds=progress*musicOptions[musicKey].duration;
    musicPlayer.src="audio/" + (musicKey==="surf" ? "surf-loop.wav" : musicKey+".wav");
    document.getElementById("timeline").max=musicOptions[musicKey].duration;
    document.getElementById("download-music").href=musicPlayer.src;
    document.querySelectorAll("[data-music]").forEach(function(button) {button.classList.toggle("selected",button.dataset.music===musicKey);});
    musicPlayer.addEventListener("loadedmetadata",function() {musicPlayer.currentTime=currentSeconds;if(wasPlaying) togglePlayback();},{once:true});
    musicPlayer.load();
    requestDraw();
}
function setDisplayMode(mode) {
    displayMode=mode;
    photographBackground.style.display=mode==="photo" ? "block" : "none";
    previewCanvas.style.mixBlendMode=mode==="photo" ? "plus-lighter" : "normal";
    document.querySelectorAll("[data-mode]").forEach(function(button) {button.classList.toggle("selected",button.dataset.mode===mode);});
    document.getElementById("mode-caption").textContent = {
        audience:"A virtual masonry surface seen from the selected audience position. The moving forms are made of bricks; the original ghost silhouettes guide the flock.",
        photo:"Only affected bricks add projected light over the dusk wall. Untouched areas stay black in the feed. Shallow edges and cavities receive less light; raised brick faces, creases, and exposed sides describe the relief without a directional spotlight. Photo pose and individual brick alignment are still approximate.",
        projector:"Full-resolution light layer. Fill frame enlarges the whole wall without stretching it; match this framing with projector zoom and alignment on site. Physical lens preview checks the saved lens and placement. Black adds no light."
    }[mode];
    document.getElementById("stage-note").textContent = mode==="projector" ? "Additive light layer · black = no light" : (mode==="photo" ? "Wall photograph + projected light · additive" : "Virtual geometry study · not a projection composite");
    updateLabels();requestDraw();
}
function updateLabels() {
    for (const [settingName,settingValue] of Object.entries(settings)) {
        const output=document.getElementById(settingName+"-value");
        let suffix="";
        if (settingName.includes("angle")) suffix="°";
        else if (settingName.includes("height") || settingName.includes("width") || settingName.includes("distance") || settingName==="relief-depth") suffix=" m";
        else if (settingName==="throw-ratio") suffix=":1";
        else if (settingName==="ghost-scale") suffix="×";
        else if (settingName==="ghost-speed") suffix="×";
        else if (settingName==="ghost-softness") suffix="";
        output.textContent=settingValue+suffix;
    }
    document.getElementById("view-label").textContent=(displayMode==="projector" ? "Projector · "+settings["projector-angle"] : "Audience · "+settings["viewer-angle"])+"°";
    photographBackground.style.filter="brightness("+(settings.ambient+0.18)+")";
    updateProjectorOutput();
    drawPlacement();
}
function drawPlacement() {
    const planCanvas=document.getElementById("placement");
    const planContext=planCanvas.getContext("2d");
    const viewerCamera=cameraFor("viewer");
    const projectorCamera=cameraFor("projector");
    const extent=Math.max(settings["viewer-distance"],settings["projector-distance"])+5;
    const planScale=290/extent;
    const centerHorizontal=250;
    const wallVertical=45;
    function planPoint(position) {return [centerHorizontal+position[0]*planScale,wallVertical+position[2]*planScale];}
    planContext.clearRect(0,0,500,370);
    planContext.strokeStyle="#353d39";planContext.lineWidth=1;
    planContext.setLineDash([3,5]);planContext.beginPath();planContext.moveTo(centerHorizontal,wallVertical);planContext.lineTo(centerHorizontal,355);planContext.stroke();planContext.setLineDash([]);
    planContext.strokeStyle="#b38967";planContext.lineWidth=7;planContext.beginPath();planContext.moveTo(centerHorizontal-settings["wall-width"]*planScale/2,wallVertical);planContext.lineTo(centerHorizontal+settings["wall-width"]*planScale/2,wallVertical);planContext.stroke();
    planContext.fillStyle="#b6bcb5";planContext.font="12px Arial";planContext.textAlign="center";planContext.fillText(settings["wall-width"]+" m WALL",250,24);
    for (const [camera,label,color] of [[viewerCamera,"Audience", "#d8a479"],[projectorCamera,"Projector", "#8caeb2"]]) {
        const point=planPoint(camera.position);
        planContext.strokeStyle=color;planContext.lineWidth=1;planContext.beginPath();planContext.moveTo(...point);planContext.lineTo(250,45);planContext.stroke();
        if(label==="Projector") {
            planContext.fillStyle="#8caeb21a";planContext.beginPath();planContext.moveTo(...point);planContext.lineTo(250-settings["wall-width"]*planScale/2,45);planContext.lineTo(250+settings["wall-width"]*planScale/2,45);planContext.fill();
        }
        planContext.fillStyle=color;planContext.beginPath();planContext.arc(...point,5,0,Math.PI*2);planContext.fill();planContext.textAlign=point[0]>380 ? "right" : "left";planContext.fillText(label,point[0]+(point[0]>380?-10:10),point[1]+4);
    }
    const projectorAimDistance=Math.hypot(settings["projector-distance"],settings["wall-height"]/2-settings["projector-height"]);
    const projectorDimensions=projectorOutputDimensions();
    const projectorAspect=projectorDimensions.width/projectorDimensions.height;
    const projectorWidth=projectorAimDistance/settings["throw-ratio"] * Math.min(1,projectorAspect);
    const screenCorners=[];
    for(const horizontalPosition of [-settings["wall-width"]/2,settings["wall-width"]/2]) for(const verticalPosition of [0,settings["wall-height"]]) screenCorners.push(cameraScreenPoint([horizontalPosition,verticalPosition,0],projectorCamera));
    const horizontalLensScale=2*settings["throw-ratio"]/Math.min(1,projectorAspect);
    const covered=screenCorners.every(function(point) {return Math.abs(point[0]*horizontalLensScale)<=1 && Math.abs(point[1]*horizontalLensScale*projectorAspect)<=1;});
    document.getElementById("placement-readout").textContent="Audience: "+viewerCamera.position[0].toFixed(1)+" m sideways, "+viewerCamera.position[2].toFixed(1)+" m perpendicular from wall. Projector: "+projectorCamera.position[0].toFixed(1)+" m sideways, "+projectorCamera.position[2].toFixed(1)+" m perpendicular. Current lens: "+(covered?"all four wall corners fit the ideal frame.":"wall is clipped; change lens, distance, or orientation.")+" Nominal image at aim distance: "+projectorWidth.toFixed(1)+" × "+(projectorWidth/projectorAspect).toFixed(1)+" m in the lens image plane.";
}
function downloadFile(filename,content,mimeType) {
    const link=document.createElement("a");
    const objectUrl=URL.createObjectURL(new Blob([content],{type:mimeType}));
    link.href=objectUrl;link.download=filename;link.click();setTimeout(function(){URL.revokeObjectURL(objectUrl);},1000);
}
function saveView() {
    const viewRecord={version:2,createdAt:new Date().toISOString(),settings:settings,photoCorners:photoCorners,mode:displayMode,music:selectedMusic,timeSeconds:currentSeconds,projectorOrientation:document.getElementById("projector-orientation").value,projectorFraming:document.getElementById("projector-framing").value,projectorResolution:projectorOutputDimensions(),seed:721,angleConvention:"Degrees from wall normal; positive x on audience's right.",calibrationStatus:"Provisional; approximate brick grid; no surveyed projector or camera pose. Fill-frame output requires matching on-site zoom and alignment."};
    localStorage.setItem("brick-relief-kept-view",JSON.stringify(viewRecord));
    downloadFile("brick-relief-kept-view.json",JSON.stringify(viewRecord,null,2),"application/json");
    document.getElementById("save-view").textContent="View kept ✓";
}
const cornerHandles=[];
for (let cornerIndex=0;cornerIndex<4;cornerIndex++) {
    const handle=document.createElement("div");handle.style.cssText="position:absolute;width:14px;height:14px;border:2px solid #f4c493;border-radius:50%;background:#181a1a;transform:translate(-50%,-50%);pointer-events:none;display:none";
    previewCanvas.parentElement.appendChild(handle);cornerHandles.push(handle);
}
function updateCornerHandles() {
    const active=displayMode==="photo" && document.getElementById("edit-corners").checked;
    const imageScale=Math.min(previewCanvas.clientWidth/photoWidth,previewCanvas.clientHeight/photoHeight);
    const offsetHorizontal=(previewCanvas.clientWidth-photoWidth*imageScale)/2;
    const offsetVertical=(previewCanvas.clientHeight-photoHeight*imageScale)/2;
    cornerHandles.forEach(function(handle,index) {handle.style.display=active?"block":"none";handle.style.left=(offsetHorizontal+photoCorners[index][0]*imageScale)+"px";handle.style.top=(offsetVertical+photoCorners[index][1]*imageScale)+"px";});
}
function photoPointFromEvent(event) {
    const rectangle=previewCanvas.getBoundingClientRect();
    const imageScale=Math.min(rectangle.width/photoWidth,rectangle.height/photoHeight);
    return [(event.clientX-rectangle.left-(rectangle.width-photoWidth*imageScale)/2)/imageScale,(event.clientY-rectangle.top-(rectangle.height-photoHeight*imageScale)/2)/imageScale];
}
previewCanvas.addEventListener("pointerdown",function(event) {
    if(displayMode!=="photo" || !document.getElementById("edit-corners").checked)return;
    const point=photoPointFromEvent(event);
    draggingCorner=photoCorners.findIndex(function(corner){return Math.hypot(corner[0]-point[0],corner[1]-point[1])<30;});
    if(draggingCorner>=0)previewCanvas.setPointerCapture(event.pointerId);
});
previewCanvas.addEventListener("pointermove",function(event) {
    if(draggingCorner<0)return;
    const point=photoPointFromEvent(event);
    photoCorners[draggingCorner]=[Math.max(0,Math.min(photoWidth,point[0])),Math.max(0,Math.min(photoHeight,point[1]))];
    updatePhotographMatrix();
});
previewCanvas.addEventListener("pointerup",function(){draggingCorner=-1;});
previewCanvas.addEventListener("pointercancel",function(){draggingCorner=-1;});

for (const settingName of Object.keys(settings)) {
    document.getElementById(settingName).addEventListener("input",function(event) {
        settings[settingName]=Number(event.target.value);
        if(["wall-width","wall-height","rows","columns","bond-offset"].includes(settingName) && rendererReady)rebuildMasonry();
        updateLabels();requestDraw();
    });
}
document.querySelectorAll("[data-angle]").forEach(function(button){button.addEventListener("click",function(){settings["viewer-angle"]=Number(button.dataset.angle);document.getElementById("viewer-angle").value=settings["viewer-angle"];updateLabels();requestDraw();});});
document.querySelectorAll("[data-mode]").forEach(function(button){button.addEventListener("click",function(){setDisplayMode(button.dataset.mode);});});
document.querySelectorAll("[data-music]").forEach(function(button){button.addEventListener("click",function(){selectMusic(button.dataset.music);});});
document.querySelectorAll("[data-scene]").forEach(function(button){button.addEventListener("click",function(){seek(BrickMotion.previewTime(button.dataset.scene,musicOptions[selectedMusic].duration,musicOptions[selectedMusic].tempo));});});
document.getElementById("timeline").addEventListener("input",function(event){seek(Number(event.target.value));});
document.getElementById("play").addEventListener("click",togglePlayback);
document.getElementById("restart").addEventListener("click",function(){seek(0);});
document.getElementById("mute").addEventListener("click",function(){musicPlayer.muted=!musicPlayer.muted;this.textContent=musicPlayer.muted?"Sound off":"Sound on";});
document.getElementById("volume").addEventListener("input",function(){musicPlayer.volume=Number(this.value);});
document.getElementById("show-grid").addEventListener("change",requestDraw);
document.getElementById("edit-corners").addEventListener("change",function(){if(this.checked)setDisplayMode("photo");requestDraw();});
for(const controlId of ["projector-orientation","projector-framing","projector-resolution"])document.getElementById(controlId).addEventListener("change",function(){updateLabels();requestDraw();});
document.getElementById("reset-corners").addEventListener("click",function(){photoCorners=defaultPhotoCorners.map(function(corner){return corner.slice();});updatePhotographMatrix();});
document.getElementById("save-view").addEventListener("click",saveView);
document.getElementById("save-frame").addEventListener("click",function(){
    renderFrame();
    const outputCanvas=document.createElement("canvas");outputCanvas.width=previewCanvas.width;outputCanvas.height=previewCanvas.height;
    const outputContext=outputCanvas.getContext("2d");
    outputContext.fillStyle="#080a0b";outputContext.fillRect(0,0,outputCanvas.width,outputCanvas.height);
    if(displayMode==="photo"){
        const imageScale=Math.min(outputCanvas.width/photoWidth,outputCanvas.height/photoHeight);
        outputContext.filter="brightness("+(settings.ambient+0.18)+")";
        outputContext.drawImage(wallPhotograph,(outputCanvas.width-photoWidth*imageScale)/2,(outputCanvas.height-photoHeight*imageScale)/2,photoWidth*imageScale,photoHeight*imageScale);
        outputContext.filter="none";
    }
    if(displayMode==="photo")outputContext.globalCompositeOperation="lighter";
    outputContext.drawImage(previewCanvas,0,0);
    const link=document.createElement("a");link.download="brick-relief-"+displayMode+"-"+Math.floor(currentSeconds)+"s.png";link.href=outputCanvas.toDataURL("image/png");link.click();
});
document.getElementById("fullscreen").addEventListener("click",function(){document.getElementById("stage").requestFullscreen();});
musicPlayer.addEventListener("play",updatePlayButton);
musicPlayer.addEventListener("pause",updatePlayButton);
musicPlayer.addEventListener("ended",function(){currentSeconds=musicOptions[selectedMusic].duration;updatePlayButton();requestDraw();});
window.addEventListener("resize",requestDraw);
document.addEventListener("fullscreenchange",requestDraw);
function showError(message) {const errorElement=document.getElementById("error-message");errorElement.hidden=false;errorElement.textContent=message;}

async function initialize() {
    try {
        if(!graphics)throw new Error("This preview needs WebGL. Try a browser with hardware acceleration enabled.");
        shaderProgram=graphics.createProgram();
        graphics.attachShader(shaderProgram,compileShader(graphics.VERTEX_SHADER,vertexSource));
        graphics.attachShader(shaderProgram,compileShader(graphics.FRAGMENT_SHADER,fragmentSource));
        graphics.linkProgram(shaderProgram);
        if(!graphics.getProgramParameter(shaderProgram,graphics.LINK_STATUS))throw new Error(graphics.getProgramInfoLog(shaderProgram));
        graphics.useProgram(shaderProgram);
        const uniformCount=graphics.getProgramParameter(shaderProgram,graphics.ACTIVE_UNIFORMS);
        for(let uniformIndex=0;uniformIndex<uniformCount;uniformIndex++){const uniformInfo=graphics.getActiveUniform(shaderProgram,uniformIndex);uniformLocations[uniformInfo.name.replace("[0]","")]=graphics.getUniformLocation(shaderProgram,uniformInfo.name);}
        const imagePaths=["assets/wall-reference.png"];
        for(let poseIndex=0;poseIndex<8;poseIndex++)imagePaths.push("assets/ghost_"+poseIndex+".png");
        const loadedImages=await Promise.all(imagePaths.map(loadImage));
        createTexture(loadedImages[0],0);
        const atlasCanvas=document.createElement("canvas");atlasCanvas.width=1024;atlasCanvas.height=192;
        const atlasContext=atlasCanvas.getContext("2d");
        // Feather the source masks before sampling them onto discrete brick courses.
        atlasContext.filter="blur(0.8px)";
        for(let poseIndex=0;poseIndex<8;poseIndex++)atlasContext.drawImage(loadedImages[poseIndex+1],poseIndex*128,0,128,192);
        createTexture(atlasCanvas,1);
        const featherAtlasCanvas=document.createElement("canvas");featherAtlasCanvas.width=1024;featherAtlasCanvas.height=192;
        const featherAtlasContext=featherAtlasCanvas.getContext("2d");
        featherAtlasContext.filter="blur(5px)";
        for(let poseIndex=0;poseIndex<8;poseIndex++){
            featherAtlasContext.save();
            featherAtlasContext.beginPath();featherAtlasContext.rect(poseIndex*128,0,128,192);featherAtlasContext.clip();
            featherAtlasContext.drawImage(loadedImages[poseIndex+1],poseIndex*128,0,128,192);
            featherAtlasContext.restore();
        }
        createTexture(featherAtlasCanvas,2);
        graphics.uniform1i(uniformLocations.wallTexture,0);graphics.uniform1i(uniformLocations.ghostAtlas,1);graphics.uniform1i(uniformLocations.ghostFeatherAtlas,2);
        graphics.enable(graphics.DEPTH_TEST);graphics.depthFunc(graphics.LEQUAL);
        masonryBuffer=graphics.createBuffer();
        rebuildMasonry();updatePhotographMatrix();updateLabels();setDisplayMode("photo");
        musicPlayer.volume=0.55;
        musicPlayer.loop=true;
        rendererReady=true;
        requestAnimationFrame(animationLoop);
    } catch(error) {showError(error.message);console.error(error);}
}
initialize();
