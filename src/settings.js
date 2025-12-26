export class SettingsPanel {
    constructor(container, initialSettings, onUpdate) {
        this.container = container;
        this.settings = initialSettings;
        this.onUpdate = onUpdate;
        this.visible = false;
        this.render();
    }

    render() {
        // Panel
        this.panel = document.createElement('div');
        this.panel.className = 'settings-panel';

        // Scrollable content area
        const body = document.createElement('div');
        body.className = 'settings-panel__body';

        // Frame Selector
        const frameGroup = document.createElement('div');
        frameGroup.className = 'settings-group';
        const frameLabel = document.createElement('label');
        frameLabel.innerText = 'MONITOR FRAME';
        const frameSelect = document.createElement('select');
        frameSelect.style.width = '100%';
        frameSelect.style.padding = '5px';
        frameSelect.style.background = '#333';
        frameSelect.style.color = '#fff';
        frameSelect.style.border = '1px solid #555';

        const frames = [
            { value: "none", label: "None" },
            { value: "c1084", label: "Commodore 1084S" },
            { value: "sonypvm", label: "Sony PVM" }
        ];


        frames.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.value;
            opt.innerText = f.label;
            if (f.value === (this.settings.frame || 'none')) opt.selected = true;
            frameSelect.appendChild(opt);
        });

        frameSelect.onchange = (e) => {
            this.settings.frame = e.target.value;
            this.onUpdate(this.settings);
        };

        frameGroup.appendChild(frameLabel);
        frameGroup.appendChild(frameSelect);
        body.appendChild(frameGroup);

        // TV Resolution Selector
        const tvGroup = document.createElement('div');
        tvGroup.className = 'settings-group';
        const tvLabel = document.createElement('label');
        tvLabel.innerText = 'TV RESOLUTION';
        const tvSelect = document.createElement('select');
        tvSelect.style.width = '100%';
        tvSelect.style.padding = '5px';
        tvSelect.style.background = '#333';
        tvSelect.style.color = '#fff';
        tvSelect.style.border = '1px solid #555';

        const tvModes = [
            { value: 'source', label: 'Source (native)' },
            { value: '240p', label: '240p (320×240)' },
            { value: '480i', label: '480i (640×480)' },
            { value: 'vga', label: 'VGA (640×480)' },
        ];

        tvModes.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.value;
            opt.innerText = m.label;
            if (m.value === (this.settings.tvResolution || 'source')) opt.selected = true;
            tvSelect.appendChild(opt);
        });

        tvSelect.onchange = (e) => {
            this.settings.tvResolution = e.target.value;
            this.onUpdate(this.settings);
        };

        tvGroup.appendChild(tvLabel);
        tvGroup.appendChild(tvSelect);
        body.appendChild(tvGroup);

        // Scaling Selector
        const scalingGroup = document.createElement('div');
        scalingGroup.className = 'settings-group';
        const scalingLabel = document.createElement('label');
        scalingLabel.innerText = 'SCALING';
        const scalingSelect = document.createElement('select');
        scalingSelect.style.width = '100%';
        scalingSelect.style.padding = '5px';
        scalingSelect.style.background = '#333';
        scalingSelect.style.color = '#fff';
        scalingSelect.style.border = '1px solid #555';

        const scalingModes = [
            { value: 'nearest', label: 'Nearest' },
            { value: 'default', label: 'Default' },
            { value: 'bilinear', label: 'Bilinear' },
            { value: 'bicubic', label: 'Bicubic' },
        ];

        scalingModes.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.value;
            opt.innerText = m.label;
            if (m.value === (this.settings.scaling || 'default')) opt.selected = true;
            scalingSelect.appendChild(opt);
        });

        scalingSelect.onchange = (e) => {
            this.settings.scaling = e.target.value;
            this.onUpdate(this.settings);
        };

        scalingGroup.appendChild(scalingLabel);
        scalingGroup.appendChild(scalingSelect);
        body.appendChild(scalingGroup);

        const controls = [
            { key: 'curvature', label: 'Curvature', min: 0, max: 1, step: 0.01 },
            { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01 },
            { key: 'scanlineIntensity', label: 'Scanlines', min: 0, max: 1, step: 0.01 },
            { key: 'scanlineCount', label: 'Scanline Count', min: 240, max: 1080, step: 10 },
            { key: 'convergence', label: 'Convergence', min: 0, max: 10, step: 0.01 },
            { key: 'interlace', label: 'Interlace', min: 0, max: 1, step: 0.01 },
            { key: 'deinterlace', label: 'Deinterlace', min: 0, max: 1, step: 0.01 },
            { key: 'overscan', label: 'Overscan', min: 0, max: 0.25, step: 0.005 },
            { key: 'border', label: 'Border', min: 0, max: 0.10, step: 0.001 },
            { key: 'geomAA', label: 'Geometry AA', min: 0, max: 1, step: 0.01 },
            { key: 'maskBrightness', label: 'Mask Strength', min: 0, max: 1, step: 0.01 },
            { key: 'maskType', label: 'Mask Type', min: 0, max: 2, step: 1 },
            { key: 'maskSize', label: 'Mask Size', min: 0.25, max: 8, step: 0.05 },
            { key: 'bloom', label: 'Bloom', min: 0, max: 1, step: 0.01 },
            { key: 'noise', label: 'Noise', min: 0, max: 1, step: 0.01 },
            { key: 'hue', label: 'Hue', min: -3.14, max: 3.14, step: 0.01 },
            { key: 'brightness', label: 'Brightness', min: 0, max: 2, step: 0.01 },
            { key: 'contrast', label: 'Contrast', min: 0, max: 2, step: 0.01 },
            { key: 'color', label: 'Color', min: 0, max: 2, step: 0.01 },
            { key: 'sharpness', label: 'Sharpness', min: -2, max: 2, step: 0.01 },
        ];

        // Rotary controls row for HUE, BRIGHTNESS, CONTRAST, COLOR, SHARPNESS
        const rotaryKeys = ['hue', 'brightness', 'contrast', 'color', 'sharpness'];
        const rotaryLabels = {
            hue: 'HUE',
            brightness: 'BRT',
            contrast: 'CON',
            color: 'COL',
            sharpness: 'SHP'
        };
        const rotaryRow = document.createElement('div');
        rotaryRow.className = 'settings-panel__bottom rotary-row';

        rotaryKeys.forEach(key => {
            const rotaryGroup = document.createElement('div');
            rotaryGroup.className = 'rotary-group';

            const label = document.createElement('label');
            label.className = 'rotary-label';
            label.textContent = rotaryLabels[key];

            // SVG rotary knob
            const size = 32;
            const radius = 14;
            const min = controls.find(c => c.key === key).min;
            const max = controls.find(c => c.key === key).max;
            const step = controls.find(c => c.key === key).step;
            let value = this.settings[key];

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', size);
            svg.setAttribute('height', size);
            svg.classList.add('rotary-knob-svg');
            svg.style.cursor = 'pointer';

            // Knob background
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', size/2);
            circle.setAttribute('cy', size/2);
            circle.setAttribute('r', radius);
            circle.setAttribute('fill', '#222');
            circle.setAttribute('stroke', '#00ff80');
            circle.setAttribute('stroke-width', '2');
            svg.appendChild(circle);


            // --- Define functions before use ---
            const getAngle = (val, min, max) => {
                // Map value to angle: min at 225deg (bottom left), max at 315deg (bottom right)
                // Arc covers 270deg (from 225 to 315, wrapping through top)
                return 225 + ((val - min) / (max - min)) * 270;
            };

            let pointer; // define here for use in setPointer
            const setPointer = (val) => {
                pointer.setAttribute('transform', `rotate(${getAngle(val, min, max)},${size/2},${size/2})`);
            };

            // Knob pointer
            pointer = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            pointer.setAttribute('x', size/2 - 1);
            pointer.setAttribute('y', size/2 - radius + 2);
            pointer.setAttribute('width', 2);
            pointer.setAttribute('height', 8);
            pointer.setAttribute('fill', '#ff3300');
            pointer.setAttribute('rx', 1);
            pointer.setAttribute('ry', 1);
            pointer.setAttribute('transform', `rotate(${getAngle(value, min, max)},${size/2},${size/2})`);
            svg.appendChild(pointer);

            let dragging = false;
            let lastAngle = null;
            // Arrow functions to preserve 'this' context
            const getCenter = (e) => {
                const rect = svg.getBoundingClientRect();
                let x, y;
                if (e.touches) {
                    x = e.touches[0].clientX;
                    y = e.touches[0].clientY;
                } else {
                    x = e.clientX;
                    y = e.clientY;
                }
                return { x: x - rect.left - size/2, y: y - rect.top - size/2 };
            };

            const angleFromCenter = (e) => {
                const {x, y} = getCenter(e);
                return Math.atan2(y, x) * 180 / Math.PI;
            };

            const startDrag = (e) => {
                e.preventDefault();
                dragging = true;
                lastAngle = angleFromCenter(e);
                document.addEventListener('mousemove', onDrag);
                document.addEventListener('touchmove', onDrag);
                document.addEventListener('mouseup', stopDrag);
                document.addEventListener('touchend', stopDrag);
            };

            const onDrag = (e) => {
                if (!dragging) return;
                let angle = angleFromCenter(e);
                let delta = angle - lastAngle;
                if (delta > 180) delta -= 360;
                if (delta < -180) delta += 360;
                let range = max - min;
                let newValue = value + (delta / 270) * range;
                newValue = Math.max(min, Math.min(max, Math.round(newValue / step) * step));
                if (newValue !== value) {
                    value = newValue;
                    setPointer(value);
                    valueSpan.textContent = Number(value).toFixed(1);
                    lastAngle = angle;
                    // Update settings and notify
                    this.settings[key] = value;
                    this.onUpdate(this.settings);
                }
            };

            const stopDrag = () => {
                dragging = false;
                document.removeEventListener('mousemove', onDrag);
                document.removeEventListener('touchmove', onDrag);
                document.removeEventListener('mouseup', stopDrag);
                document.removeEventListener('touchend', stopDrag);
            };

            svg.addEventListener('mousedown', startDrag);
            svg.addEventListener('touchstart', startDrag);

            const valueSpan = document.createElement('span');
            valueSpan.className = 'label-value';
            valueSpan.textContent = Number(value).toFixed(1);
            valueSpan.style.marginTop = '0.2em';
            valueSpan.style.fontSize = '0.8em';
            valueSpan.style.textAlign = 'center';
            valueSpan.style.display = 'block';
            valueSpan.style.width = '100%';

            rotaryGroup.appendChild(label);
            rotaryGroup.appendChild(svg);
            rotaryGroup.appendChild(valueSpan);
            rotaryRow.appendChild(rotaryGroup);
        });
        this.panel.appendChild(rotaryRow);

        // All other controls (except rotary)
        controls.filter(ctrl => !rotaryKeys.includes(ctrl.key)).forEach(ctrl => {
                        const group = document.createElement('div');
                        group.className = 'settings-group';

                        const label = document.createElement('label');
                        label.style.display = 'flex';
                        label.style.justifyContent = 'space-between';
                        label.style.alignItems = 'center';

                        const labelText = document.createElement('span');
                        labelText.textContent = ctrl.label.toUpperCase();

                        const valueSpan = document.createElement('span');
                        valueSpan.className = 'label-value';
                        valueSpan.textContent = this.settings[ctrl.key];

                        label.appendChild(labelText);
                        label.appendChild(valueSpan);

                        let input;
                        if (ctrl.key === 'maskType') {
                                input = document.createElement('select');
                                input.style.width = '100%';
                                input.style.padding = '5px';
                                input.style.background = '#333';
                                input.style.color = '#fff';
                                input.style.border = '1px solid #555';
                                const maskOptions = [
                                    { value: 0, label: 'Aperture' },
                                    { value: 1, label: 'Shadow' },
                                    { value: 2, label: 'None' }
                                ];
                                maskOptions.forEach(opt => {
                                    const option = document.createElement('option');
                                    option.value = opt.value;
                                    option.innerText = opt.label;
                                    if (parseInt(this.settings[ctrl.key]) === opt.value) option.selected = true;
                                    input.appendChild(option);
                                });
                                input.onchange = (e) => {
                                    const val = parseInt(e.target.value);
                                    this.settings[ctrl.key] = val;
                                    valueSpan.textContent = maskOptions.find(o => o.value === val).label;
                                    this.onUpdate(this.settings);
                                };
                                // Show label instead of value
                                valueSpan.textContent = maskOptions.find(o => o.value === parseInt(this.settings[ctrl.key])).label;
                        } else {
                                input = document.createElement('input');
                                input.type = 'range';
                                input.min = ctrl.min;
                                input.max = ctrl.max;
                                input.step = ctrl.step;
                                input.value = this.settings[ctrl.key];
                                input.oninput = (e) => {
                                        const val = parseFloat(e.target.value);
                                        this.settings[ctrl.key] = val;
                                        valueSpan.textContent = val;
                                        this.onUpdate(this.settings);
                                };
                        }

                        group.appendChild(label);
                        group.appendChild(input);
                        body.appendChild(group);
        });

        this.panel.appendChild(body);
        this.panel.appendChild(rotaryRow);
        this.container.appendChild(this.panel);
    }
}
