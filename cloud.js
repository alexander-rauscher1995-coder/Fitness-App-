import { createClient } from "https://esm.sh/@neondatabase/neon-js@latest";

const AUTH_URL = "https://ep-weathered-sunset-b2a14fxa.neonauth.c-6.eu-central-1.aws.neon.tech/neondb/auth";
const DATA_API_URL = "https://ep-weathered-sunset-b2a14fxa.apirest.c-6.eu-central-1.aws.neon.tech/neondb/rest/v1";
const STORAGE_KEY = "fitnessTrackerProSafeV1";
const DEVICE_KEY = "fitnessTrackerProDeviceV1";
const authClient = createClient({ auth: { url: AUTH_URL }, dataApi: { url: DATA_API_URL } });
let activeUser = null;
let syncTimer = null;
let busy = false;

const $ = (id) => document.getElementById(id);
const readLocal = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
  catch { return null; }
};
const writeLocal = (value) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("fitness:cloud-restored", { detail: { data: value } }));
};
const deviceId = () => {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
};
const status = (message, error = false) => {
  const el = $("cloudStatus");
  if (el) {
    el.textContent = message;
    el.style.color = error ? "var(--red)" : "var(--green)";
  }
  const button = $("accountBtn");
  if (button) button.textContent = activeUser ? "☁ Konto" : "☁ Anmelden";
};
const errorMessage = (error) => error?.message || "Das hat gerade nicht geklappt. Bitte erneut versuchen.";

function mount() {
  if (!$("accountBtn")) {
    const header = document.querySelector(".top");
    const button = document.createElement("button");
    button.id = "accountBtn";
    button.className = "btn secondary";
    button.type = "button";
    button.textContent = "☁ Anmelden";
    header?.append(button);
  }
  const style = document.createElement("style");
  style.textContent = `
    .cloud-shade{position:fixed;inset:0;z-index:60;background:#020706cc;backdrop-filter:blur(10px);display:none;align-items:center;justify-content:center;padding:18px}
    .cloud-shade.open{display:flex}.cloud-panel{width:min(100%,430px);background:#121d19;border:1px solid #30443a;border-radius:22px;padding:22px;box-shadow:0 24px 80px #0009}
    .cloud-panel h2{margin:0 0 6px}.cloud-panel p{color:var(--muted);font-size:13px}
    .cloud-panel label{display:block;color:var(--muted);font-size:12px;font-weight:700;margin:12px 0 5px}
    .cloud-panel input{width:100%;background:#0b1410;border:1px solid #30443a;color:var(--ink);border-radius:11px;padding:12px}
    .cloud-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:16px}.cloud-actions button{flex:1}
    .cloud-note{font-size:11px!important;line-height:1.5}.cloud-message{min-height:20px;font-size:12px;color:var(--red);margin-top:9px}
  `;
  document.head.append(style);
  const shade = document.createElement("div");
  shade.className = "cloud-shade";
  shade.id = "cloudShade";
  shade.innerHTML = `
    <section class="cloud-panel" role="dialog" aria-modal="true" aria-labelledby="cloudTitle">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div><div class="eyebrow">FITNESS TRACKER PRO</div><h2 id="cloudTitle">Cloud-Konto</h2></div>
        <button id="cloudClose" class="btn secondary" type="button" aria-label="Schließen">✕</button>
      </div>
      <p id="cloudIntro">Melde dich an, um deine Einträge sicher zwischen iPhone und PC zu synchronisieren.</p>
      <div id="cloudSignedOut">
        <label for="cloudName">Name (nur bei Registrierung)</label><input id="cloudName" autocomplete="name" placeholder="Dein Name">
        <label for="cloudEmail">E-Mail</label><input id="cloudEmail" type="email" autocomplete="email" placeholder="name@beispiel.de">
        <label for="cloudPassword">Passwort</label><input id="cloudPassword" type="password" autocomplete="current-password" minlength="8" placeholder="Mindestens 8 Zeichen">
        <div class="cloud-actions">
          <button id="cloudSignIn" class="btn" type="button">Anmelden</button>
          <button id="cloudSignUp" class="btn secondary" type="button">Konto erstellen</button>
        </div>
      </div>
      <div id="cloudSignedIn" hidden>
        <div class="notice"><b id="cloudUser"></b><div class="small">Dein Konto ist angemeldet.</div></div>
        <div class="cloud-actions">
          <button id="cloudSyncNow" class="btn" type="button">Jetzt synchronisieren</button>
          <button id="cloudSignOut" class="btn secondary" type="button">Abmelden</button>
        </div>
      </div>
      <div id="cloudMessage" class="cloud-message" role="status"></div>
      <p class="cloud-note">Deine Check-ins und Trainingseinträge werden nur deinem angemeldeten Konto zugeordnet. Verwende ein eigenes, nicht wiederverwendetes Passwort. Melde dich auf gemeinsam genutzten Geräten nach der Nutzung ab.</p>
    </section>`;
  document.body.append(shade);
  $("accountBtn").addEventListener("click", openModal);
  $("cloudClose").addEventListener("click", closeModal);
  shade.addEventListener("click", (event) => { if (event.target === shade) closeModal(); });
  $("cloudSignIn").addEventListener("click", signIn);
  $("cloudSignUp").addEventListener("click", signUp);
  $("cloudSignOut").addEventListener("click", signOut);
  $("cloudSyncNow").addEventListener("click", () => sync(true));
}
function openModal() { $("cloudShade").classList.add("open"); }
function closeModal() { $("cloudShade").classList.remove("open"); }
function message(text, error = true) {
  const el = $("cloudMessage");
  if (el) { el.textContent = text; el.style.color = error ? "var(--red)" : "var(--green)"; }
}
function setAccount(user) {
  activeUser = user || null;
  $("cloudSignedOut").hidden = !!activeUser;
  $("cloudSignedIn").hidden = !activeUser;
  $("cloudUser").textContent = activeUser?.name || activeUser?.email || "Angemeldet";
  $("cloudIntro").textContent = activeUser
    ? "Deine Daten werden mit deinem persönlichen Cloud-Konto synchronisiert."
    : "Melde dich an, um deine Einträge zwischen iPhone und PC zu synchronisieren.";
  status(activeUser ? "Konto angemeldet" : "Nur lokal gespeichert");
}
async function signIn() {
  message("");
  const email = $("cloudEmail").value.trim();
  const password = $("cloudPassword").value;
  if (!email || !password) return message("Bitte E-Mail und Passwort eingeben.");
  $("cloudSignIn").disabled = true;
  try {
    const result = await authClient.auth.signIn.email({ email, password });
    if (result.error) throw result.error;
    await refreshSession();
    await sync(true);
    message("Erfolgreich angemeldet.", false);
  } catch (error) { message(errorMessage(error)); }
  finally { $("cloudSignIn").disabled = false; }
}
async function signUp() {
  message("");
  const name = $("cloudName").value.trim();
  const email = $("cloudEmail").value.trim();
  const password = $("cloudPassword").value;
  if (!name || !email || password.length < 8) return message("Bitte Name, gültige E-Mail und ein Passwort mit mindestens 8 Zeichen eingeben.");
  $("cloudSignUp").disabled = true;
  try {
    const result = await authClient.auth.signUp.email({ name, email, password });
    if (result.error) throw result.error;
    await refreshSession();
    await sync(true);
    message("Konto erstellt und angemeldet.", false);
  } catch (error) { message(errorMessage(error)); }
  finally { $("cloudSignUp").disabled = false; }
}
async function refreshSession() {
  const result = await authClient.auth.getSession();
  if (result.error) throw result.error;
  const session = result.data?.session || result.data;
  setAccount(session?.user || null);
}
async function signOut() {
  try {
    const result = await authClient.auth.signOut();
    if (result.error) throw result.error;
    setAccount(null);
    message("Du bist abgemeldet.", false);
    status("Nur lokal gespeichert");
  } catch (error) { message(errorMessage(error)); }
}
function localHasEntries(data) {
  return !!(data && ((data.daily?.length || 0) + (data.workouts?.length || 0) + (data.weekly?.length || 0) > 0));
}
async function sync(manual = false) {
  if (!activeUser || busy || !navigator.onLine) {
    if (!navigator.onLine) status("Offline – Änderungen bleiben auf diesem Gerät");
    return;
  }
  busy = true;
  status("Synchronisiere …");
  try {
    const read = await authClient.from("fitness_snapshots")
      .select("user_id,revision,device_id,updated_at,snapshot")
      .eq("user_id", activeUser.id)
      .limit(1);
    if (read.error) throw read.error;
    const remote = read.data?.[0] || null;
    const local = readLocal() || { daily: [], workouts: [], weekly: [], settings: { sessions: 3, sleep: "8" } };
    let chosen = local;
    if (remote?.snapshot && manual) {
      const useCloud = confirm("Es gibt bereits einen Cloud-Spielstand. OK = Cloud-Daten auf dieses Gerät laden. Abbrechen = Daten dieses Geräts in die Cloud übertragen.");
      if (useCloud) {
        chosen = remote.snapshot;
        writeLocal(chosen);
      }
    } else if (remote?.snapshot && !localHasEntries(local)) {
      chosen = remote.snapshot;
      writeLocal(chosen);
    }
    const revision = Number(remote?.revision || 0) + 1;
    const write = await authClient.from("fitness_snapshots").upsert({
      user_id: activeUser.id,
      revision,
      device_id: deviceId(),
      updated_at: new Date().toISOString(),
      snapshot: chosen
    }, { onConflict: "user_id" });
    if (write.error) throw write.error;
    status("Synchronisiert · " + new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }));
    if (manual) message("Synchronisierung abgeschlossen.", false);
  } catch (error) {
    console.error("Cloud sync error:", error);
    status("Synchronisierung fehlgeschlagen", true);
    if (manual) message(errorMessage(error));
  } finally { busy = false; }
}
function scheduleSync() {
  if (!activeUser) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync(false), 1200);
}
window.addEventListener("fitness:changed", scheduleSync);
window.addEventListener("online", () => { if (activeUser) sync(false); });
window.addEventListener("fitness:cloud-restored", () => status("Cloud-Daten geladen"));
mount();
refreshSession().then(() => { if (activeUser) sync(false); }).catch((error) => {
  console.error("Auth session check failed:", error);
  status("Anmeldung derzeit nicht erreichbar", true);
});
