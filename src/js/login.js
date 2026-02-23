/**
 * snap_automation.js
 *
 * Automates Snap! (https://snap.berkeley.edu/snap/snap.html) using Playwright.
 * All actions use the official Snap! functions from cloud.js and gui.js directly,
 * bypassing the graphical UI as much as possible.
 *
 * Actions covered:
 *  1. Open the editor and log in via cloud.js → Cloud.prototype.login()
 *  2. Open a cloud project via cloud.js → Cloud.prototype.getProject() +
 *                                         gui.js  → IDE_Morph.prototype.openCloudDataString()
 *  3. Create a new sprite  → IDE_Morph.prototype.addNewSprite()
 *  4. Select a sprite by name → IDE_Morph.prototype.selectSprite()
 *  5. Upload an image to the current sprite → IDE_Morph.prototype.droppedImage() /
 *                                             IDE_Morph.prototype.droppedSVG()
 *  6. Upload audio to the current sprite   → IDE_Morph.prototype.droppedAudio()
 *  7. Import a sprite from a .sprite/.xml file → IDE_Morph.prototype.openSpritesString()
 *
 * Install:  npm install playwright
 *           npx playwright install chromium
 */

const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const USERNAME     = 'manueljb';
const PASSWORD     = '17luglioSna#';
const PROJECT_NAME = 'Snake';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Snap! sends the password as a SHA-512 hex digest.
 * Source: cloud.js → Cloud.prototype.login()  (uses hex_sha512(password))
 */
function hex_sha512(password) {
    return crypto.createHash('sha512').update(password).digest('hex');
}

/**
 * Wait until the Snap! world and IDE are fully initialised inside the page.
 * gui.js mounts everything under `world.children[0]` (an IDE_Morph).
 */
async function waitForIDE(page) {
    await page.waitForFunction(() =>
            typeof world !== 'undefined' &&
            world.children.length > 0 &&
            world.children[0].cloud !== undefined,
        { timeout: 20000 }
    );
}

/**
 * Run a function inside the page and return its result.
 * Errors thrown inside the page bubble up as normal JS errors.
 */
async function snap(page, fn, ...args) {
    return page.evaluate(fn, ...args);
}

// ─── 1. LOGIN ─────────────────────────────────────────────────────────────────
/**
 * Logs in using Cloud.prototype.login() from cloud.js.
 * The password travels as a SHA-512 hash inside the POST body to:
 *   POST /api/v1/users/{username}/login?persist=true
 *
 * We bypass the DialogBoxMorph / promptCredentials UI entirely.
 */
async function login(page, username, password) {
    const hashedPassword = hex_sha512(password);

    await snap(page, async ({ username, hashedPassword }) => {
        await new Promise((resolve, reject) => {
            const ide = world.children[0];
            ide.cloud.login(
                username,
                hashedPassword,  // cloud.js hashes the pw; we pre-hash so we pass
                // the hash directly as the "password" argument.
                // cloud.js will call hex_sha512() on it again,
                // so we must pass the raw password here instead:
                true, // persist session
                (loggedInUsername) => resolve(loggedInUsername),
                (err) => reject(new Error('Login failed: ' + err))
            );
        });
    }, { username, hashedPassword });

    // NOTE: cloud.js → login() calls hex_sha512(password) internally,
    // so we must pass the PLAIN password, not the pre-hashed one.
    // The fetch call above is therefore re-done correctly below.
}

/**
 * Correct login: pass the plain password; cloud.js hashes it internally.
 * Source: cloud.js → Cloud.prototype.login()
 *   body = hex_sha512(password)   ← done inside cloud.js
 *   POST /api/v1/users/{username}/login?persist=true
 */
async function loginCorrect(page, username, password) {
    await snap(page, ({ username, password }) => {
        return new Promise((resolve, reject) => {
            const ide = world.children[0];
            ide.cloud.login(
                username.toLowerCase(),
                password,   // cloud.js calls hex_sha512(password) internally
                true,       // persist = stay signed in
                (loggedInUsername, role, response) => {
                    // gui.js → initializeCloud() success handler:
                    sessionStorage.username = loggedInUsername;
                    ide.controlBar.cloudButton.refresh();
                    ide.source = 'cloud';
                    resolve(loggedInUsername);
                },
                (err) => reject(new Error(err))
            );
        });
    }, { username, password });

    console.log(`✓ Logged in as ${username}`);
}

// ─── 2. OPEN A CLOUD PROJECT ──────────────────────────────────────────────────
/**
 * Opens a project from the cloud without any dialog.
 * Source: gui.js → ProjectDialogMorph.prototype.rawOpenCloudProject()
 *   cloud.getProject(projectname, null, clouddata => ide.openCloudDataString(clouddata))
 */
async function openCloudProject(page, projectName) {
    await snap(page, (projectName) => {
        return new Promise((resolve, reject) => {
            const ide = world.children[0];
            // cloud.js → Cloud.prototype.getProject() — authenticated GET
            ide.cloud.getProject(
                projectName,
                null, // delta
                clouddata => {
                    // gui.js → IDE_Morph.prototype.openCloudDataString()
                    ide.openCloudDataString(clouddata);
                    resolve();
                },
                (err) => reject(new Error('Could not open project: ' + err))
            );
        });
    }, projectName);

    console.log(`✓ Project "${projectName}" opened`);
}

// ─── 3. CREATE A NEW SPRITE ───────────────────────────────────────────────────
/**
 * Creates a new blank sprite.
 * Source: gui.js → IDE_Morph.prototype.addNewSprite()
 */
async function addNewSprite(page) {
    const name = await snap(page, () => {
        const ide = world.children[0];
        ide.addNewSprite();                        // gui.js
        return ide.currentSprite.name;             // returns the auto-assigned name
    });
    console.log(`✓ New sprite created: "${name}"`);
    return name;
}

// ─── 4. SELECT A SPRITE BY NAME ───────────────────────────────────────────────
/**
 * Selects (makes current) a sprite by name.
 * Source: gui.js → IDE_Morph.prototype.selectSprite()
 */
async function selectSpriteByName(page, spriteName) {
    const found = await snap(page, (spriteName) => {
        const ide = world.children[0];
        // ide.sprites is the List of all sprites in the scene
        const sprite = ide.sprites.asArray().find(s => s.name === spriteName);
        if (!sprite) return false;
        ide.selectSprite(sprite);   // gui.js
        return true;
    }, spriteName);

    if (!found) throw new Error(`Sprite "${spriteName}" not found`);
    console.log(`✓ Selected sprite "${spriteName}"`);
}

// ─── 5. UPLOAD AN IMAGE TO A SPRITE ──────────────────────────────────────────
/**
 * Uploads a local image file (PNG/JPG/GIF) or SVG to the currently selected sprite
 * as a new costume.
 *
 * Source:
 *   - Raster: gui.js → IDE_Morph.prototype.droppedImage(aCanvas, name)
 *   - SVG:    gui.js → IDE_Morph.prototype.droppedSVG(anImage, name)
 *
 * @param {Page}   page
 * @param {string} spriteName  - target sprite (will be selected)
 * @param {string} filePath    - absolute path to the local image file
 */
async function uploadImageToSprite(page, spriteName, filePath) {
    await selectSpriteByName(page, spriteName);

    const fileBuffer = fs.readFileSync(filePath);
    const fileName   = path.basename(filePath);
    const ext        = path.extname(filePath).toLowerCase().slice(1); // 'png', 'svg', …
    const base64     = fileBuffer.toString('base64');
    const isSVG      = ext === 'svg';
    const mimeTypes  = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg',
        gif:'image/gif', svg:'image/svg+xml' };
    const mime       = mimeTypes[ext] || 'image/png';
    const dataURL    = `data:${mime};base64,${base64}`;

    await snap(page, ({ dataURL, fileName, isSVG }) => {
        return new Promise((resolve, reject) => {
            const ide = world.children[0];
            const img = new Image();
            img.onload = () => {
                if (isSVG) {
                    // gui.js → IDE_Morph.prototype.droppedSVG(anImage, name)
                    ide.droppedSVG(img, fileName);
                } else {
                    // gui.js → IDE_Morph.prototype.droppedImage(aCanvas, name)
                    const canvas = document.createElement('canvas');
                    canvas.width  = img.width  || 100;
                    canvas.height = img.height || 100;
                    canvas.getContext('2d').drawImage(img, 0, 0);
                    ide.droppedImage(canvas, fileName);
                }
                resolve();
            };
            img.onerror = () => reject(new Error('Image load failed: ' + fileName));
            img.src = dataURL;
        });
    }, { dataURL, fileName, isSVG });

    console.log(`✓ Image "${fileName}" uploaded to sprite "${spriteName}"`);
}

// ─── 6. UPLOAD AUDIO TO A SPRITE ─────────────────────────────────────────────
/**
 * Uploads a local audio file (MP3/WAV/OGG) to the currently selected sprite
 * as a new sound.
 *
 * Source: gui.js → IDE_Morph.prototype.droppedAudio(anAudio, name)
 *   Expects anAudio.src to start with 'data:audio' (base64).
 *   Internally calls: ide.currentSprite.addSound(anAudio, name)
 *
 * @param {Page}   page
 * @param {string} spriteName  - target sprite (will be selected)
 * @param {string} filePath    - absolute path to the local audio file
 */
async function uploadAudioToSprite(page, spriteName, filePath) {
    await selectSpriteByName(page, spriteName);

    const fileBuffer = fs.readFileSync(filePath);
    const fileName   = path.basename(filePath);
    const ext        = path.extname(filePath).toLowerCase().slice(1);
    const base64     = fileBuffer.toString('base64');
    const mimeTypes  = { mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg' };
    const mime       = mimeTypes[ext] || 'audio/mpeg';
    const dataURL    = `data:${mime};base64,${base64}`;

    await snap(page, ({ dataURL, fileName }) => {
        return new Promise((resolve, reject) => {
            const ide   = world.children[0];
            const audio = new Audio();
            audio.src   = dataURL; // starts with 'data:audio' → direct path in droppedAudio
            audio.oncanplaythrough = () => {
                // gui.js → IDE_Morph.prototype.droppedAudio(anAudio, name)
                ide.droppedAudio(audio, fileName);
                resolve();
            };
            audio.onerror = () => reject(new Error('Audio load failed: ' + fileName));
            audio.load();
        });
    }, { dataURL, fileName });

    console.log(`✓ Audio "${fileName}" uploaded to sprite "${spriteName}"`);
}

// ─── 7. IMPORT A SPRITE FROM FILE ─────────────────────────────────────────────
/**
 * Imports a sprite from a Snap! sprite XML export file (.sprite or .xml).
 * These files start with <sprites> and are handled by:
 *
 * Source: gui.js → IDE_Morph.prototype.droppedText(aString, name, fileType)
 *   → recognises '<sprites' prefix
 *   → calls IDE_Morph.prototype.openSpritesString(aString)
 *   → calls IDE_Morph.prototype.rawOpenSpritesString(aString)
 *   → calls IDE_Morph.prototype.deserializeSpritesString(aString)
 *   → calls this.serializer.loadSpritesModel(xml, this)
 *
 * @param {Page}   page
 * @param {string} filePath - absolute path to the .sprite/.xml file
 */
async function importSpriteFromFile(page, filePath) {
    const xmlString = fs.readFileSync(filePath, 'utf8');
    const fileName  = path.basename(filePath);

    await snap(page, ({ xmlString, fileName }) => {
        const ide = world.children[0];
        // droppedText() detects the '<sprites' prefix and routes to openSpritesString()
        ide.droppedText(xmlString, fileName, '');
    }, { xmlString, fileName });

    console.log(`✓ Sprite imported from "${fileName}"`);
}

// ─── 8. SAVE PROJECT TO CLOUD ─────────────────────────────────────────────────
/**
 * Saves the current project back to the cloud.
 *
 * Source chain (gui.js):
 *   IDE_Morph.prototype.save()
 *     → IDE_Morph.prototype.saveProjectToCloud(name)
 *       → IDE_Morph.prototype.buildProjectRequest()   ← serializes xml + media + thumbnail
 *       → IDE_Morph.prototype.verifyProject(body)     ← checks < 10 MB, parses back
 *       → cloud.js: Cloud.prototype.saveProject()     ← POST /api/v1/projects/{user}/{name}
 *         → IDE_Morph.prototype.recordSavedChanges()  ← clears the unsaved-changes flag
 *
 * Call this after any of: addNewSprite(), uploadImageToSprite(),
 * uploadAudioToSprite(), or importSpriteFromFile().
 */
async function saveProjectToCloud(page) {
    await snap(page, () => {
        return new Promise((resolve, reject) => {
            const ide = world.children[0];

            // Ensure source is 'cloud' so ide.save() takes the right branch.
            // This is set automatically by openCloudProject(), but we enforce it
            // here defensively (gui.js → saveProjectToCloud checks this implicitly
            // via the save() dispatcher).
            ide.source = 'cloud';

            const name = ide.getProjectName();
            if (!name) {
                reject(new Error('No project name — open a project first'));
                return;
            }

            // buildProjectRequest() serializes xml + media + thumbnail
            const projectBody = ide.buildProjectRequest();

            // verifyProject() checks size < 10 MB and that the XML round-trips
            const projectSize = ide.verifyProject(projectBody);
            if (!projectSize) {
                reject(new Error('Project failed verification (too large or bad XML)'));
                return;
            }

            // cloud.js → Cloud.prototype.saveProject()
            //   POST /api/v1/projects/{username}/{projectName}
            ide.cloud.saveProject(
                name,
                projectBody,
                (message) => {
                    ide.recordSavedChanges(); // clears the unsaved-changes flag
                    resolve(message);
                },
                (err) => reject(new Error('Cloud save failed: ' + err))
            );
        });
    });

    console.log(`✓ Project saved to cloud`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

(async () => {
    const browser = await chromium.launch({ headless: false }); // set true for CI
    const page    = await browser.newPage();

    // ── 1. Open the Snap! editor ──────────────────────────────────────────────
    await page.goto('https://snap.berkeley.edu/snap/snap.html');
    console.log('Waiting for Snap! IDE to initialise…');
    await waitForIDE(page);
    console.log('✓ Snap! editor ready');

    // ── 2. Log in (no UI dialogs) ─────────────────────────────────────────────
    await loginCorrect(page, USERNAME, PASSWORD);

    // ── 3. Open a project from the cloud (no UI dialogs) ─────────────────────
    await openCloudProject(page, PROJECT_NAME);

    // Give the project a moment to fully deserialise before acting on it
    await page.waitForTimeout(1500);

    // // ── 4. Create a new sprite ────────────────────────────────────────────────
    // const newSpriteName = await addNewSprite(page);
    //
    // // ── 5. Upload an image to a specific sprite ───────────────────────────────
    // Replace with your actual file paths:

    const pathCactus = path.resolve(__dirname, '../../public/image/cactus2.png');
    await uploadImageToSprite(page, "apple", pathCactus);
    await saveProjectToCloud(page);
    // Also works with SVG:
    // await uploadImageToSprite(page, newSpriteName, '/path/to/your/icon.svg');
    //
    // // ── 6. Upload audio to a specific sprite ─────────────────────────────────
    // await uploadAudioToSprite(page, newSpriteName, '/path/to/your/sound.mp3');
    //
    // // ── 7. Import a sprite from a local .sprite XML file ─────────────────────
    // await importSpriteFromFile(page, '/path/to/your/exported_sprite.xml');
    //
    // console.log('\n✓ All done!');
    // await browser.close();
})();