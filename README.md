<div align="center">

<img src="src/assets/logo/logo1.svg" width="150" height="150" alt="Snap Argos Logo"/>

# Snap Argos

**🇮🇹 Italiano** · [🇬🇧 English](#-english)

</div>

---

## 🇮🇹 Italiano

**Snap Argos** è uno strumento web che permette agli utenti registrati su [Snap! (UC Berkeley)](https://snap.berkeley.edu) di esplorare e gestire i propri contenuti cloud direttamente dal browser, in modo più rapido e intuitivo rispetto all'interfaccia ufficiale.

### ✨ Funzionalità

- 📂 **Visualizza** tutti i tuoi progetti, sprite e stage presenti sul cloud Snap!
- ⬆️ **Carica file** sul tuo account senza dover selezionare manualmente progetti o stage specifici
- 🖼️ **Image Editor** — editor di immagini client-side per trim e resize in batch (vedi sotto)
- 🔒 **Nessun dato salvato** — le credenziali e i dati vengono usati solo in tempo reale e non vengono mai archiviati
- 🌐 **Accessibile pubblicamente** — nessuna installazione richiesta

### 🖼️ Image Editor

La pagina **Image Editor** permette di modificare immagini direttamente nel browser senza caricarle su alcun server. Supporta l'elaborazione in batch di più immagini con una pipeline di azioni configurabile.

#### Formati supportati

PNG, JPG, GIF, WEBP, SVG

#### Upload immagini

- Drag & drop di file o cartelle nella drop zone
- Selezione tramite file picker (file singoli o cartelle intere)
- Quando si caricano cartelle, la struttura delle directory viene preservata nel download (ZIP)

#### Azioni disponibili

**Trim** — ritaglio dei bordi dell'immagine:
- **Auto-trim**: rimuove automaticamente i bordi trasparenti (alpha = 0) attorno al contenuto visibile dell'immagine
- **Trim manuale**: permette di specificare quanti pixel rimuovere da ciascun lato (top, right, bottom, left)

**Resize** — ridimensionamento dell'immagine:
- **Scale %**: ridimensiona l'immagine in base a una percentuale (es. 50% dimezza entrambe le dimensioni)
- **Fixed px**: imposta una dimensione fissa in pixel (larghezza × altezza)
  - **Keep ratio** (attivo di default): mantiene le proporzioni originali dell'immagine adattando la dimensione all'interno del rettangolo specificato
  - **Stretch**: disattivando "Keep ratio", l'immagine viene deformata per riempire esattamente le dimensioni specificate

#### Pipeline di azioni

- È possibile aggiungere più azioni (trim e resize) in sequenza
- L'ordine delle azioni è modificabile tramite drag & drop nel pannello "Run"
- Ogni azione viene applicata in cascata: il risultato di un'azione diventa l'input della successiva
- I toggle "Keep" permettono di mantenere immagini e/o azioni dopo l'esecuzione

#### Download

- Singola immagine: download diretto del file
- Più immagini senza cartelle: download multiplo dei singoli file
- Immagini da cartelle: download come ZIP preservando la struttura delle directory originali

### ⚙️ Come funziona

Snap Argos si interfaccia con le API di Snap! tramite le credenziali dell'utente. Tutti i dati rimangono tra il browser dell'utente e i server di Snap! — nulla passa o viene memorizzato su server propri.

### ⚠️ Note

- Snap Argos **non è affiliato** con UC Berkeley o il team di Snap!
- Le API utilizzate non sono ufficialmente documentate e potrebbero cambiare in qualsiasi momento
- L'utente è responsabile del rispetto dei [Termini di Servizio di Snap!](https://snap.berkeley.edu/tos)
- Le donazioni sono facoltative e non garantiscono funzionalità aggiuntive

### 📬 Contatti

Per segnalazioni o domande: **argos.dev.07@gmail.com**

---

## 🇬🇧 English

**Snap Argos** is a web tool that allows registered [Snap! (UC Berkeley)](https://snap.berkeley.edu) users to explore and manage their cloud content directly from the browser, faster and more intuitively than the official interface.

### ✨ Features

- 📂 **Browse** all your projects, sprites and stages stored on the Snap! cloud
- ⬆️ **Upload files** to your account without manually selecting specific projects or stages
- 🖼️ **Image Editor** — client-side image editor for batch trim and resize (see below)
- 🔒 **No data stored** — credentials and data are used only in real time and are never saved
- 🌐 **Publicly accessible** — no installation required

### 🖼️ Image Editor

The **Image Editor** page lets you edit images directly in the browser without uploading them to any server. It supports batch processing of multiple images with a configurable action pipeline.

#### Supported formats

PNG, JPG, GIF, WEBP, SVG

#### Image upload

- Drag & drop files or folders into the drop zone
- Select via file picker (single files or entire folders)
- When uploading folders, the directory structure is preserved in the download (ZIP)

#### Available actions

**Trim** — crop image borders:
- **Auto-trim**: automatically removes transparent borders (alpha = 0) around the visible content of the image
- **Manual trim**: specify how many pixels to remove from each side (top, right, bottom, left)

**Resize** — scale the image:
- **Scale %**: resize the image by a percentage (e.g. 50% halves both dimensions)
- **Fixed px**: set a fixed size in pixels (width × height)
  - **Keep ratio** (enabled by default): maintains the original aspect ratio, fitting the image within the specified rectangle
  - **Stretch**: when "Keep ratio" is disabled, the image is stretched to fill exactly the specified dimensions

#### Action pipeline

- Multiple actions (trim and resize) can be added in sequence
- Action order can be rearranged via drag & drop in the "Run" panel
- Each action is applied in cascade: the output of one action becomes the input for the next
- "Keep" toggles let you preserve images and/or actions after execution

#### Download

- Single image: direct file download
- Multiple images without folders: multiple individual file downloads
- Images from folders: ZIP download preserving the original directory structure

### ⚙️ How it works

Snap Argos communicates with the Snap! API using the user's own credentials. All data flows directly between the user's browser and Snap!'s servers — nothing is stored or logged on any external server.

### ⚠️ Notes

- Snap Argos is **not affiliated** with UC Berkeley or the Snap! team
- The APIs used are not officially documented and may change at any time
- Users are responsible for complying with the [Snap! Terms of Service](https://snap.berkeley.edu/tos)
- Donations are voluntary and do not provide any additional features

### 📬 Contact

For feedback or questions: **argos.dev.07@gmail.com**

---

<div align="center">

Made with ❤️ · <a href="https://snap.berkeley.edu">Snap! (UC Berkeley)</a>

</div>
