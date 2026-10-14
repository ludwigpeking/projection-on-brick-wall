"use strict";
const assert=require("node:assert/strict");
const motion=require("../motion.js");
const observedFaceCounts=new Set();
for(const tempo of [88,120,138]) {
    const configuration={wallWidth:8,wallHeight:12,ghostCount:8,ghostScale:1.55,ghostSpeed:3.5,duration:100,tempo:tempo,flockBeatStrength:0.8};
    const sections=motion.sectionsFor(configuration.duration,tempo);
    assert(sections.length>=8,"Music must revisit short sections.");
    assert.deepEqual(sections.slice(0,3).map(function(section){return section.kind;}),["faces","flock","dance"]);
    for(let sectionIndex=1;sectionIndex<sections.length;sectionIndex++) {
        assert.equal(sections[sectionIndex].startBeat,sections[sectionIndex-1].endBeat);
        assert.notEqual(sections[sectionIndex].kind,sections[sectionIndex-1].kind,"Avoid repeating the same scene back-to-back.");
        assert(sections[sectionIndex].endBeat-sections[sectionIndex].startBeat<=24);
    }
    const extraRowDepths=[];
    let maximumFlockDepth=0;
    let maximumDanceCount=0;
    let minimumMainDancerDepth=Infinity;
    let maximumMainDancerDepth=0;
    let mixedDancerDepthsObserved=false;
    for(let timeSeconds=0;timeSeconds<=100;timeSeconds+=0.13) {
        const scene=motion.sceneAt(timeSeconds,100,tempo);
        const faces=motion.facesAt(timeSeconds,100,tempo,8,12,0.38);
        const ghosts=motion.flockAt(timeSeconds,configuration);
        if(scene.kind==="dance" && scene.envelope>0.99 && scene.localBeats>2) {
            const mainDancerDepths=Array.from({length:12},function(unused,ghostIndex){return ghosts.appearances[ghostIndex*4];});
            minimumMainDancerDepth=Math.min(minimumMainDancerDepth,...mainDancerDepths);
            maximumMainDancerDepth=Math.max(maximumMainDancerDepth,...mainDancerDepths);
            if(Math.min(...mainDancerDepths)<0.05 && Math.max(...mainDancerDepths)>1.5)mixedDancerDepthsObserved=true;
        }
        assert.equal(ghosts.positions.length,96);
        assert(ghosts.count<=24);
        if(scene.kind!=="faces")assert.equal(faces.strength,0,"Faces must never leak into boids or dance.");
        else {
            assert.equal(ghosts.count,0,"Ghosts must be absent during faces.");
            observedFaceCounts.add(faces.count);
        }
        for(let ghostIndex=0;ghostIndex<ghosts.count;ghostIndex++) {
            const offset=ghostIndex*4;
            assert(Number.isFinite(ghosts.appearances[offset]));
            assert(Math.abs(ghosts.positions[offset])<=4.00001);
            assert(ghosts.positions[offset+1]>=0 && ghosts.positions[offset+1]<=12);
            if(ghosts.appearances[offset+1]===0)assert.equal(ghosts.appearances[offset+3],1);
            if(scene.kind==="flock")maximumFlockDepth=Math.max(maximumFlockDepth,ghosts.appearances[offset]);
            if(scene.kind==="dance") {
                assert.equal(ghosts.appearances[offset+1],0,"Dancers face outward.");
                maximumDanceCount=Math.max(maximumDanceCount,ghosts.count);
                if(ghostIndex===ghosts.count-1)extraRowDepths.push(ghosts.appearances[offset]);
            }
        }
    }
    assert(maximumFlockDepth>4,"Some boids must approach substantially farther.");
    assert(maximumDanceCount>=18,"Dancing has its own population beyond eight boids.");
    assert(minimumMainDancerDepth<0.05,"Main-row dancers must nearly retract during the active scene.");
    assert(maximumMainDancerDepth>2,"Dancers must still make substantial outward pops.");
    assert(mixedDancerDepthsObserved,"Dancers must retract independently while others stay raised.");
    assert(Math.max(...extraRowDepths)>1 && Math.min(...extraRowDepths)<0.01,"Interstitial dancers must emerge and return independently.");
    for(const section of sections) {
        for(let beatIndex=section.startBeat+1;beatIndex<section.endBeat;beatIndex++) {
            if(section.kind!=="faces")continue;
            const peak=motion.facesAt((beatIndex+0.22)*60/tempo,100,tempo,8,12,0.38);
            assert(peak.strength>0.7);
            assert.equal(motion.facesAt((beatIndex+0.99)*60/tempo,100,tempo,8,12,0.38).strength,0);
        }
        if(section.kind!=="flock")continue;
        const timeSeconds=(section.startBeat+5.12)*60/tempo;
        if(timeSeconds>=100)continue;
        const base=motion.flockAt(timeSeconds,{...configuration,flockBeatStrength:0});
        const pulsing=motion.flockAt(timeSeconds,configuration);
        for(let ghostIndex=0;ghostIndex<configuration.ghostCount;ghostIndex++) {
            const offset=ghostIndex*4;
            assert.deepEqual(base.positions.slice(offset,offset+3),pulsing.positions.slice(offset,offset+3),"Beat expansion must not alter boid centers or heading.");
            assert(pulsing.positions[offset+3]>base.positions[offset+3]*1.14,"Each beat must visibly enlarge the boid.");
            assert(pulsing.appearances[offset]-base.appearances[offset]>0.8,"Each beat must produce a strong depth pop.");
        }
        assert(pulsing.appearances[0]>base.appearances[0]);
        const releasedSeconds=(section.startBeat+5.9)*60/tempo;
        if(releasedSeconds<configuration.duration)assert.deepEqual(
            motion.flockAt(releasedSeconds,configuration),
            motion.flockAt(releasedSeconds,{...configuration,flockBeatStrength:0}),
            "Size and depth pulses must both fully settle within the beat."
        );
        const repeat=motion.flockAt(timeSeconds,configuration);
        motion.flockAt(timeSeconds+1,configuration);
        assert.deepEqual(repeat,motion.flockAt(timeSeconds,configuration),"Seeking must be deterministic.");
    }
    const end=motion.flockAt(100,configuration);
    assert(end.appearances.every(function(value,index){return index%4!==0 || value===0;}),"Track must return to rest before looping.");
}
assert.equal(observedFaceCounts.size,4);
// Size changes cannot pull boids into a smaller travel realm.
const configuration={wallWidth:8,wallHeight:12,ghostCount:12,ghostScale:1.55,ghostSpeed:3.5,duration:97.3913,tempo:138};
const timeSeconds=motion.previewTime("flock",configuration.duration,configuration.tempo);
const small=motion.flockAt(timeSeconds,{...configuration,ghostScale:1});
const large=motion.flockAt(timeSeconds,{...configuration,ghostScale:2.4});
for(let ghostIndex=0;ghostIndex<12;ghostIndex++) {
    assert.equal(small.positions[ghostIndex*4],large.positions[ghostIndex*4]);
    assert.equal(small.positions[ghostIndex*4+1],large.positions[ghostIndex*4+1]);
    assert(large.positions[ghostIndex*4+3]>small.positions[ghostIndex*4+3]);
}
console.log("PASS: exclusive scenes at all tempos; short shuffled reprises; per-beat faces; stronger boids; independent 18–23 dancer population; interstitial emergence; bounds; neutral poses; beat-independent steering; deterministic seeking; zero-depth loop seam.");
