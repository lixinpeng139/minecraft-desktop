// 标题画面全景图（CubeMap.render）：透视 85°，俯仰 10°，以 0.1°/tick 旋转

import { texUrl, loadImage } from './assets.js';

const VS = `
attribute vec3 aPos;
attribute vec2 aUv;
uniform mat4 uMvp;
varying vec2 vUv;
void main() { vUv = aUv; gl_Position = uMvp * vec4(aPos, 1.0); }`;

const FS = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(uTex, vUv); }`;

// 与游戏中 6 个面的顶点顺序一致：(x, y, z, u, v)
const FACES = [
  [[-1, -1, 1, 0, 0], [-1, 1, 1, 0, 1], [1, 1, 1, 1, 1], [1, -1, 1, 1, 0]],
  [[1, -1, 1, 0, 0], [1, 1, 1, 0, 1], [1, 1, -1, 1, 1], [1, -1, -1, 1, 0]],
  [[1, -1, -1, 0, 0], [1, 1, -1, 0, 1], [-1, 1, -1, 1, 1], [-1, -1, -1, 1, 0]],
  [[-1, -1, -1, 0, 0], [-1, 1, -1, 0, 1], [-1, 1, 1, 1, 1], [-1, -1, 1, 1, 0]],
  [[-1, -1, -1, 0, 0], [-1, -1, 1, 0, 1], [1, -1, 1, 1, 1], [1, -1, -1, 1, 0]],
  [[-1, 1, 1, 0, 0], [-1, 1, -1, 0, 1], [1, 1, -1, 1, 1], [1, 1, 1, 1, 0]],
];

function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
}

function rotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

function rotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

export class Panorama {
  constructor(canvas) {
    this.canvas = canvas;
    this.spin = 0;
    this.ready = false;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true });
    this.gl = gl;
    if (!gl) return;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    this.prog = p;
    this.uMvp = gl.getUniformLocation(p, 'uMvp');
    this.aPos = gl.getAttribLocation(p, 'aPos');
    this.aUv = gl.getAttribLocation(p, 'aUv');
    const data = new Float32Array(FACES.flat(2));
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.textures = [];
    Promise.all([0, 1, 2, 3, 4, 5].map((i) => loadImage(texUrl('gui/title/background/panorama_' + i)))).then((imgs) => {
      this.textures = imgs.map((img) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
      });
      this.ready = true;
    });
  }

  /** dtTicks：本帧经过的 tick 数（20 tick/秒） */
  update(dtTicks, speed) {
    this.spin = (this.spin + dtTicks * speed * 0.1) % 360;
  }

  render() {
    const gl = this.gl;
    if (!gl || !this.ready) return;
    const w = this.canvas.width, h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    const proj = perspective((85 * Math.PI) / 180, w / h, 0.05, 10);
    // rotationX(π) → rotateX(10°) → rotateY(-spin)
    const mv = mul(mul(rotX(Math.PI), rotX((10 * Math.PI) / 180)), rotY((-this.spin * Math.PI) / 180));
    gl.uniformMatrix4fv(this.uMvp, false, mul(proj, mv));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(this.aPos);
    gl.enableVertexAttribArray(this.aUv);
    gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 20, 0);
    gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 20, 12);
    for (let i = 0; i < 6; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.textures[i]);
      gl.drawArrays(gl.TRIANGLE_FAN, i * 4, 4);
    }
  }
}
