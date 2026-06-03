<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Minecraft Web Client – Client</title>

<style>
    body {
        margin: 0;
        overflow: hidden;
        background: #000;
        font-family: "Segoe UI", Arial, sans-serif;
    }

    #leftJoystickArea {
        position: fixed;
        left: 0;
        bottom: 0;
        width: 40%;
        height: 50%;
        touch-action: none;
    }

    #rightLookArea {
        position: fixed;
        right: 0;
        bottom: 0;
        width: 60%;
        height: 100%;
        touch-action: none;
    }

    #joystickBase, #joystickStick {
        position: absolute;
        border-radius: 50%;
        background: rgba(255,255,255,0.2);
        display: none;
    }

    #joystickBase {
        width: 120px;
        height: 120px;
        margin-left: -60px;
        margin-top: -60px;
    }

    #joystickStick {
        width: 60px;
        height: 60px;
        margin-left: -30px;
        margin-top: -30px;
        background: rgba(255,255,255,0.4);
    }
</style>
</head>

<body>

<!-- Joystick UI -->
<div id="leftJoystickArea">
    <div id="joystickBase"></div>
    <div id="joystickStick"></div>
</div>

<!-- Camera Look Area -->
<div id="rightLookArea"></div>

<!-- Three.js Renderer -->
<canvas id="gameCanvas"></canvas>

<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r152/three.min.js"></script>

<script>
// SECURE ENTRY CHECK
(function() {
    const params = new URLSearchParams(window.location.search);
    const entry = params.get("entry");
    const stored = sessionStorage.getItem("entryToken");

    if (!entry || entry !== stored) {
        window.location.href = "index.html";
        return;
    }

    sessionStorage.removeItem("entryToken");
})();

// THREE.JS SETUP
const canvas = document.getElementById("gameCanvas");
const renderer = new THREE.WebGLRenderer({ canvas });
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // sky

const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.set(0, 2, 5);

// Simple ground
const groundGeo = new THREE.PlaneGeometry(200, 200);
const groundMat = new THREE.MeshLambertMaterial({ color: 0x55aa55 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Light
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 5);
scene.add(light);

// MOVEMENT VARIABLES
let moveX = 0;
let moveY = 0;
let camYaw = 0;
let camPitch = 0;

// JOYSTICK LOGIC
const joystickArea = document.getElementById("leftJoystickArea");
const base = document.getElementById("joystickBase");
const stick = document.getElementById("joystickStick");

let joyActive = false;
let joyStartX = 0;
let joyStartY = 0;

joystickArea.addEventListener("touchstart", e => {
    const t = e.touches[0];
    joyActive = true;
    joyStartX = t.clientX;
    joyStartY = t.clientY;

    base.style.left = joyStartX + "px";
    base.style.top = joyStartY + "px";
    stick.style.left = joyStartX + "px";
    stick.style.top = joyStartY + "px";

    base.style.display = "block";
    stick.style.display = "block";
});

joystickArea.addEventListener("touchmove", e => {
    if (!joyActive) return;
    const t = e.touches[0];

    const dx = t.clientX - joyStartX;
    const dy = t.clientY - joyStartY;

    const dist = Math.min(50, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);

    const stickX = joyStartX + Math.cos(angle) * dist;
    const stickY = joyStartY + Math.sin(angle) * dist;

    stick.style.left = stickX + "px";
    stick.style.top = stickY + "px";

    moveX = Math.cos(angle) * (dist / 50);
    moveY = Math.sin(angle) * (dist / 50);
});

joystickArea.addEventListener("touchend", () => {
    joyActive = false;
    moveX = 0;
    moveY = 0;
    base.style.display = "none";
    stick.style.display = "none";
});

// CAMERA LOOK LOGIC
const lookArea = document.getElementById("rightLookArea");
let lookActive = false;
let lastX = 0;
let lastY = 0;

lookArea.addEventListener("touchstart", e => {
    const t = e.touches[0];
    lookActive = true;
    lastX = t.clientX;
    lastY = t.clientY;
});

lookArea.addEventListener("touchmove", e => {
    if (!lookActive) return;
    const t = e.touches[0];

    const dx = t.clientX - lastX;
    const dy = t.clientY - lastY;

    camYaw -= dx * 0.005;
    camPitch -= dy * 0.005;

    camPitch = Math.max(-1.2, Math.min(1.2, camPitch));

    lastX = t.clientX;
    lastY = t.clientY;
});

lookArea.addEventListener("touchend", () => {
    lookActive = false;
});

// DESKTOP CONTROLS
document.addEventListener("mousemove", e => {
    if (e.buttons === 1) {
        camYaw -= e.movementX * 0.002;
        camPitch -= e.movementY * 0.002;
        camPitch = Math.max(-1.2, Math.min(1.2, camPitch));
    }
});

const keys = {};
document.addEventListener("keydown", e => keys[e.key] = true);
document.addEventListener("keyup", e => keys[e.key] = false);

// GAME LOOP
function animate() {
    requestAnimationFrame(animate);

    // Desktop WASD
    let forward = 0;
    let strafe = 0;

    if (keys["w"]) forward += 1;
    if (keys["s"]) forward -= 1;
    if (keys["a"]) strafe -= 1;
    if (keys["d"]) strafe += 1;

    // Mobile joystick overrides desktop
    if (joyActive) {
        forward = moveY;
        strafe = moveX;
    }

    const speed = 0.1;
    const dir = new THREE.Vector3();

    dir.x = Math.sin(camYaw) * forward + Math.cos(camYaw) * strafe;
    dir.z = Math.cos(camYaw) * forward - Math.sin(camYaw) * strafe;

    camera.position.x += dir.x * speed;
    camera.position.z += dir.z * speed;

    // Apply camera rotation
    camera.rotation.order = "YXZ";
    camera.rotation.y = camYaw;
    camera.rotation.x = camPitch;

    renderer.render(scene, camera);
}

animate();
</script>

</body>
</html>
