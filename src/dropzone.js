export class Dropzone {
    constructor(container, onMediaReady) {
        this.container = container;
        this.onMediaReady = onMediaReady;
        this.element = null;
        this.render();
        this.attachEvents();
    }

    render() {
        this.element = document.createElement('div');
        this.element.className = 'dropzone';
        this.element.innerHTML = `
            <div class="dropzone-content">
                <h1>MiniCRT</h1>
                <p>Drag & Drop an Image or Video</p>
                <p>or</p>
                <button id="webcam-btn" class="btn">Start Webcam</button>
                <button id="screen-btn" class="btn">Share Screen</button>
            </div>
        `;
        this.container.appendChild(this.element);
    }

    attachEvents() {
        // Drag & Drop
        // Attach to both the overlay and the container so dropping works even
        // when the overlay is hidden (it uses pointer-events: none).
        const wireDnD = (target) => {
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                target.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                }, false);
            });
            target.addEventListener('drop', (e) => this.handleDrop(e), false);
        };

        wireDnD(this.element);
        wireDnD(this.container);

        // Webcam
        const btn = this.element.querySelector('#webcam-btn');
        btn.addEventListener('click', () => this.startWebcam());

        // Screen Share
        const screenBtn = this.element.querySelector('#screen-btn');
        screenBtn.addEventListener('click', () => this.startScreenShare());
    }

    handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;

        if (files.length > 0) {
            const file = files[0];
            const url = URL.createObjectURL(file);

            if (file.type.startsWith('image/')) {
                const img = new Image();
                img.onload = () => {
                    this.onMediaReady(img);
                    this.hide();
                    URL.revokeObjectURL(url);
                };
                img.src = url;
            } else if (file.type.startsWith('video/')) {
                const video = document.createElement('video');
                video.src = url;
                video.loop = true;
                video.muted = true;
                video.onloadedmetadata = () => {
                    this.onMediaReady(video);
                    this.hide();
                    URL.revokeObjectURL(url);
                };
            }
        }
    }

    async startWebcam() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            const video = document.createElement('video');
            video.srcObject = stream;
            video.muted = true;
            video.playsInline = true;

            const start = async () => {
                try { await video.play(); } catch { /* ignore */ }
                this.onMediaReady(video);
                this.hide();
            };

            if (video.readyState >= 1) start();
            else video.onloadedmetadata = start;
        } catch (err) {
            console.error("Error accessing webcam:", err);
            alert("Could not access webcam.");
        }
    }

    async startScreenShare() {
        try {
            if (!navigator.mediaDevices?.getDisplayMedia) {
                alert('Screen capture not supported in this browser.');
                return;
            }

            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
            const video = document.createElement('video');
            video.srcObject = stream;
            video.muted = true;
            video.playsInline = true;

            const start = async () => {
                try { await video.play(); } catch { /* ignore */ }
                this.onMediaReady(video);
                this.hide();
            };

            const [track] = stream.getVideoTracks();
            if (track) {
                track.onended = () => this.show();
            }

            if (video.readyState >= 1) start();
            else video.onloadedmetadata = start;
        } catch (err) {
            console.error('Error starting screen capture:', err);
            alert('Could not start screen capture.');
        }
    }

    hide() {
        this.element.classList.add('hidden');
    }
    
    show() {
        this.element.classList.remove('hidden');
    }
}
