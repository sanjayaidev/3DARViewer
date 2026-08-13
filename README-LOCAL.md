# Running 3D AR Viewer Locally (Node.js)

This package includes a tiny dependency-free Node.js static server (`server.js`)
so you can run the site without Vercel.

## 1. Requirements
- Node.js installed (v14+ is fine). Check with:
  ```
  node -v
  ```

## 2. Run the server
From inside this folder:
```bash
npm start
```
or directly:
```bash
node server.js
```

Then open:
```
http://localhost:8000
```

You can change the port:
```bash
PORT=3000 node server.js
```

## 3. Testing AR mode on your phone

`<model-viewer>` will render 3D models fine over plain HTTP on localhost,
but actual AR (placing the model in your room via camera) requires **HTTPS**
— browsers block WebXR/AR features on insecure origins.

Easiest way to test AR on a real phone:

1. Start the server: `node server.js`
2. In a separate terminal, install and run ngrok (free):
   ```bash
   npx ngrok http 8000
   ```
3. Ngrok gives you a public `https://...ngrok-free.app` URL.
4. Open that URL on your phone (same or different network) and tap the AR icon.

Alternative: use `mkcert` to generate a local HTTPS cert and serve over
`https://<your-computer-IP>:8000` on the same Wi-Fi network as your phone.

## Files
- `server.js` — plain Node http server, serves static files with correct MIME types (including .glb/.gltf)
- `package.json` — run with `npm start`
