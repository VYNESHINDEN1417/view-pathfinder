# View Pathfinder

PROJECT: Minimalist Rust-Based 3D Model Viewer



Build a fully functional, single-page 3D model viewer using Rust and WebAssembly.



The attached files contain the 3D model that must be displayed.



1. PRIMARY OBJECTIVE



Create a minimalist website whose ONLY visible content upon opening is the 3D model.



There must be:



- No navigation bar.

- No header.

- No footer.

- No buttons.

- No text.

- No menus.

- No loading instructions.

- No unnecessary interface elements.

- No decorative website components.



The 3D model itself must occupy the entire available browser viewport.



Use a completely black (#000000) background.



The model must be visible immediately after loading.



2. TECHNOLOGY REQUIREMENTS



Use:



- Rust as the primary programming language.

- WebAssembly for browser execution.

- wgpu for 3D rendering.

- tobj or an equivalent Rust OBJ parser.

- Rust-based MTL parsing.

- HTML and CSS only for the browser shell and presentation.



Do not implement the actual 3D rendering engine using Three.js or another JavaScript rendering library.



JavaScript may be used strictly for browser interoperability when necessary.



3. MODEL LOADING



Use the attached OBJ file as the primary geometry source.



Load its corresponding MTL file and all referenced texture files.



Requirements:



- Preserve original model geometry.

- Preserve material assignments.

- Preserve texture mapping.

- Preserve model proportions.

- Do not simplify or modify the ship's structure.

- Do not automatically discard small geometry.

- Correctly handle multiple objects and material groups.

- Automatically calculate the model's bounding box.

- Automatically center the model within the viewing space.

- Automatically adjust the initial camera distance to fit the entire model.



If a referenced texture or material cannot be loaded, handle the failure gracefully rather than crashing.



4. CAMERA CONTROLS



The primary interaction is direct manipulation of the 3D model.



The camera must support unrestricted three-dimensional inspection.



DESKTOP:



- Left mouse drag: Orbit around the model.

- Right mouse drag: Pan camera.

- Mouse scroll: Zoom in and out.

- Double-click: Reset camera focus and framing.



MOBILE:



- One-finger drag: Orbit around the model.

- Two-finger pinch: Zoom.

- Two-finger drag: Pan.

- Double-tap: Reset camera focus and framing.



The camera must support rotation around all three spatial axes.



Avoid restricting the camera to horizontal rotation only.



Implement smooth, responsive camera movement without noticeable input lag.



Prevent accidental page scrolling and browser gestures while interacting with the viewer.



5. FULLSCREEN INTERACTION



The initial website must display the model without any additional interface.



When the user clicks or taps the model:



1. Enter fullscreen mode when supported by the browser.

2. Expand the viewer to occupy the entire screen.

3. Keep the model centered.

4. Enable unrestricted three-dimensional rotation.

5. Preserve the current camera orientation and zoom level.



The viewer must also work if fullscreen mode is unavailable or denied by the browser.



Clicking or tapping the model must never accidentally rotate it or trigger unwanted camera movement.



Use pointer movement thresholds to distinguish clicks from dragging.



Support exiting fullscreen through the browser's native fullscreen controls or Escape key.



6. RESPONSIVE DESIGN



The viewer must work on:



- Android smartphones.

- iPhones.

- Tablets.

- Windows desktops.

- macOS desktops.

- Modern browsers supporting WebGPU.



Adapt rendering resolution to the available screen dimensions and device capabilities.



Do not stretch or distort the model when changing screen orientation.



Support both portrait and landscape mobile orientations.



7. PERFORMANCE



Prioritize:



- Stable rendering.

- Efficient GPU resource management.

- Low memory overhead.

- Responsive touch interactions.

- Efficient texture loading.

- Proper handling of large OBJ files.



Avoid unnecessary CPU processing during idle periods.



Use indexed geometry where appropriate.



Do not continuously reload or reprocess the model after initialization.



Implement proper cleanup of GPU resources when the viewer is destroyed.



If WebGPU is unavailable, provide a graceful fallback if technically feasible. Do not silently substitute a JavaScript-based 3D rendering engine.



8. VISUAL PRESENTATION



The model should be the absolute focus.



Use:



- Pure black background.

- Original material colors and textures.

- Neutral, adjustable lighting.

- Smooth shading where appropriate.

- Correct perspective projection.

- Anti-aliasing where supported.



Do not add:



- Watermarks.

- Branding.

- Toolbars.

- Navigation controls.

- Floating buttons.

- Informational panels.

- Text overlays.

- Decorative borders.



The result should resemble a clean, professional 3D engineering inspection viewer.



9. DELIVERABLES



Produce a complete, working project with:



- Rust source code.

- WebAssembly compilation configuration.

- HTML entry point.

- CSS styling.

- Required dependencies.

- Model-loading implementation.

- Desktop mouse controls.

- Mobile touch controls.

- Fullscreen functionality.

- Build and deployment instructions.



Do not provide a mockup or static representation.



The actual attached 3D model must render and be interactable.



10. ACCEPTANCE TESTS



The project is only considered successful when:



1. The website opens directly into the 3D viewer.

2. The attached ship model loads correctly.

3. The MTL materials and textures are preserved.

4. Desktop mouse controls work.

5. Mobile touch controls work.

6. The model can be inspected from all three spatial axes.

7. Clicking or tapping enters fullscreen where supported.

8. The viewer remains functional without fullscreen support.

9. No unnecessary interface elements appear.

10. The website works without requiring users to install additional software.



IMPORTANT: Do not introduce additional features beyond the requested scope. Prioritize a functional, lightweight, minimalist 3D viewer over unnecessary complexity.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://view-pathfinder.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c748f135-c4f8-4e98-98fe-e6fada77934c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
