import './style.css';
import { Renderer } from './renderer.js';
import { Dropzone } from './dropzone.js';
import { SettingsPanel } from './settings.js';

const app = document.querySelector('#app');

// Create Layout Containers
const canvasContainer = document.createElement('div');
canvasContainer.className = 'canvas-container';
app.appendChild(canvasContainer);

// Create Monitor Frame Image
const monitorFrame = document.createElement('img');
monitorFrame.className = 'monitor-frame';
monitorFrame.src = ''; // Will be set by settings
canvasContainer.appendChild(monitorFrame);

// Create Canvas
const canvas = document.createElement('canvas');
canvasContainer.appendChild(canvas);

// Initialize Renderer
const renderer = new Renderer(canvas, monitorFrame);

// Initialize Dropzone
// Note: Dropzone appends itself to the container passed to it
const dropzone = new Dropzone(canvasContainer, (mediaSource) => {
    renderer.setSource(mediaSource);
});

// Initialize Settings
const settingsPanel = new SettingsPanel(app, renderer.settings, (newSettings) => {
    renderer.updateSettings(newSettings);
});

// Handle window resize
window.addEventListener('resize', () => {
    renderer.resize();
});

