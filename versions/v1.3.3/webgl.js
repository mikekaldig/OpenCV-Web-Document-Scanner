// Minimal WebGL helper for image preprocessing (PoC)
// Provides: initWebGL(canvas), processWebGL(sourceCanvas, options)

window.WebGLPoC = (() => {
  let gl = null;
  let program = null;
  let positionBuffer = null;
  let texCoordBuffer = null;
  let texture = null;
  let framebuffer = null;
  let outputTexture = null;
  let readbackBuffer = null; // Uint8Array reused for gl.readPixels

  const vertexSrc = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
      v_texCoord = a_texCoord;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  // Grayscale + simple 3x3 box blur
  const fragmentSrc = `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_image;
    uniform vec2 u_texelSize;

    vec3 toGray(vec3 c) {
      float y = dot(c, vec3(0.299, 0.587, 0.114));
      return vec3(y, y, y);
    }

    void main() {
      vec2 t = u_texelSize;
      vec3 sum = vec3(0.0);
      for (int dy=-1; dy<=1; dy++) {
        for (int dx=-1; dx<=1; dx++) {
          vec2 off = vec2(float(dx), float(dy)) * t;
          vec3 c = texture2D(u_image, v_texCoord + off).rgb;
          sum += toGray(c);
        }
      }
      vec3 blurred = sum / 9.0;
      gl_FragColor = vec4(blurred, 1.0);
    }
  `;

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('WebGL shader compile error: ' + info);
    }
    return shader;
  }

  function createProgram(gl, vsSrc, fsSrc) {
    const vs = createShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error('WebGL link error: ' + info);
    }
    return prog;
  }

  function initWebGL(outputCanvas) {
    gl = outputCanvas.getContext('webgl', { preserveDrawingBuffer: true }) ||
         outputCanvas.getContext('experimental-webgl', { preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL not supported');

    program = createProgram(gl, vertexSrc, fragmentSrc);
    positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    // fullscreen quad
    const positions = new Float32Array([
      -1, -1,  1, -1,  -1, 1,
       1, -1,  1,  1,  -1, 1
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    const texCoords = new Float32Array([
      0, 0,  1, 0,  0, 1,
      1, 0,  1, 1,  0, 1
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Framebuffer not required for simple single-pass to default framebuffer
  framebuffer = null;
  }

  function ensureOutputTexture(width, height) {
    // Not used in default framebuffer path; keep for future multi-pass usage
    if (outputTexture) {
      gl.deleteTexture(outputTexture);
      outputTexture = null;
    }
  }

  function processWebGL(sourceCanvas, options = {}) {
    const width = sourceCanvas.width;
    const height = sourceCanvas.height;
    if (!gl) throw new Error('WebGL not initialized');

    // Upload source as texture
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);

    // Render directly to the WebGL canvas (default framebuffer)
    gl.canvas.width = width;
    gl.canvas.height = height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.useProgram(program);

    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const texLoc = gl.getAttribLocation(program, 'a_texCoord');
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

    const texelLoc = gl.getUniformLocation(program, 'u_texelSize');
    gl.uniform2f(texelLoc, 1.0 / width, 1.0 / height);

    const imageLoc = gl.getUniformLocation(program, 'u_image');
    gl.uniform1i(imageLoc, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Clear once to initialize buffer
    gl.clearColor(0,0,0,1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Optionally return pixels for CPU consumers without using 2D canvas
    if (options && options.readPixels) {
      // Allocate/reuse readback buffer
      const size = width * height * 4;
      if (!readbackBuffer || readbackBuffer.length !== size) {
        readbackBuffer = new Uint8Array(size);
      }
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, readbackBuffer);
      return { pixels: readbackBuffer, width, height, canvas: gl.canvas };
    }

    // Return the WebGL canvas with the rendered result
    return gl.canvas;
  }

  return { initWebGL, processWebGL };
})();
