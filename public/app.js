import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs, query, where, orderBy, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* ====== 1) Pega tu Firebase config ====== */
const firebaseConfig = {
  apiKey: "PASTE",
  authDomain: "PASTE",
  projectId: "PASTE",
  storageBucket: "PASTE",
  messagingSenderId: "PASTE",
  appId: "PASTE"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

/* ====== UI refs ====== */
const $ = (s) => document.querySelector(s);
const authView = $("#authView");
const appView = $("#appView");
const btnGoogle = $("#btnGoogle");
const btnLogout = $("#btnLogout");
const authMsg = $("#authMsg");
const tenantSelect = $("#tenantSelect");
const brandName = $("#brandName");
const datePick = $("#datePick");
const btnNewAppt = $("#btnNewAppt");
const viewBody = $("#viewBody");
const viewTitle = $("#viewTitle");

/* ====== PWA install ====== */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $("#btnInstall").hidden = false;
});
$("#btnInstall").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt = null;
  $("#btnInstall").hidden = true;
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");

/* ====== Helpers ====== */
const yyyyMmDd = (d=new Date()) => d.toISOString().slice(0,10);
datePick.value = yyyyMmDd();

let state = { uid:null, tenantId:null, role:null, tenant:null };

async function ensureUserProfile(user){
  // perfil global
  const uref = doc(db, "users", user.uid);
  const snap = await getDoc(uref);
  if (!snap.exists()){
    await setDoc(uref, {
      email: user.email || null,
      name: user.displayName || null,
      photoURL: user.photoURL || null,
      createdAt: serverTimestamp()
    }, { merge:true });
  }
}

async function loadTenantsForUser(uid){
  // Membership: users/{uid}/memberships/{tenantId}
  const colRef = collection(db, "users", uid, "memberships");
  const qSnap = await getDocs(colRef);
  const tenants = [];
  for (const m of qSnap.docs){
    tenants.push({ tenantId: m.id, ...m.data() });
  }
  return tenants;
}

async function loadTenant(tenantId){
  const tref = doc(db, "tenants", tenantId);
  const t = await getDoc(tref);
  if (!t.exists()) throw new Error("Tenant no existe.");
  return { id: t.id, ...t.data() };
}

function setBrand(tenant){
  brandName.textContent = tenant.branding?.name || tenant.name || "Premium Agenda";
  document.querySelector('meta[name="theme-color"]').setAttribute("content", tenant.branding?.themeColor || "#0b0f1a");
}

/* ====== Auth ====== */
btnGoogle.addEventListener("click", async () => {
  authMsg.textContent = "";
  try{
    await signInWithPopup(auth, provider);
  }catch(err){
    authMsg.textContent = err.message;
  }
});

btnLogout.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (!user){
    authView.hidden = false;
    appView.hidden = true;
    btnLogout.hidden = true;
    return;
  }
  btnLogout.hidden = false;
  await ensureUserProfile(user);

  // cargar memberships
  const memberships = await loadTenantsForUser(user.uid);

  // Premium UX: si no tiene negocio, crea uno demo automático (solo para dev)
  if (memberships.length === 0){
    authMsg.textContent = "No tienes negocio asignado. (En producción, esto lo maneja un admin.)";
    // Aquí normalmente NO auto-creamos. Pero te lo dejo limpio para producción.
  }

  // Llenar selector
  tenantSelect.innerHTML = "";
  memberships.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.tenantId;
    opt.textContent = m.tenantName || m.tenantId;
    tenantSelect.appendChild(opt);
  });

  state.uid = user.uid;
  state.tenantId = memberships[0]?.tenantId || null;
  if (state.tenantId){
    tenantSelect.value = state.tenantId;
    await bootTenant(state.tenantId, memberships[0]?.role || "staff");
  }

  authView.hidden = true;
  appView.hidden = false;
});

tenantSelect.addEventListener("change", async () => {
  state.tenantId = tenantSelect.value;
  await bootTenant(state.tenantId, "staff"); // el rol real se lee en backend luego
});

async function bootTenant(tenantId, role){
  state.role = role;
  state.tenant = await loadTenant(tenantId);
  setBrand(state.tenant);
  await renderAgenda();
}

/* ====== Agenda ====== */
async function renderAgenda(){
  viewTitle.textContent = "Agenda";
  viewBody.innerHTML = `<div class="muted">Cargando citas…</div>`;

  const day = datePick.value;
  // Por simplicidad: mostramos “citas del día” ordenadas.
  // En premium, guardamos start como Timestamp y consultamos rango.
  const apptsRef = collection(db, "tenants", state.tenantId, "appointments");
  const qy = query(apptsRef, where("day", "==", day), orderBy("startMin", "asc"));
  const snap = await getDocs(qy);

  const items = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  if (items.length === 0){
    viewBody.innerHTML = `<div class="item">Nada para hoy. Buen momento para vender. 😄</div>`;
    return;
  }

  viewBody.innerHTML = `
    <div class="list">
      ${items.map(a => `
        <div class="item">
          <div class="row">
            <strong>${a.title || "Cita"}</strong>
            <span class="badge">${a.status || "confirmed"}</span>
          </div>
          <div class="row">
            <span class="muted">${a.day} • ${fmtMin(a.startMin)} - ${fmtMin(a.endMin)}</span>
            <span class="muted">${a.customerName || ""}</span>
          </div>
          <div class="muted">${a.serviceName || ""} ${a.resourceName ? "• " + a.resourceName : ""}</div>
        </div>
      `).join("")}
    </div>
  `;
}

datePick.addEventListener("change", renderAgenda);

btnNewAppt.addEventListener("click", async () => {
  // Premium: modal. Aquí: quick create para probar motor.
  const title = prompt("Título de la cita:", "Servicio");
  if (!title) return;

  const day = datePick.value;
  // demo: 10:00-11:00
  const startMin = 10*60, endMin = 11*60;

  await addDoc(collection(db, "tenants", state.tenantId, "appointments"), {
    day,
    title,
    startMin,
    endMin,
    status: "confirmed",
    createdAt: serverTimestamp(),
    // Campos premium (se llenan desde clientes/servicios)
    customerName: "",
    serviceName: "",
    resourceName: "",
    // Calendario / WhatsApp
    gcal: { synced:false, eventId:null },
    whatsapp: { queued:true }
  });

  await renderAgenda();
});

function fmtMin(m){
  const hh = String(Math.floor(m/60)).padStart(2,"0");
  const mm = String(m%60).padStart(2,"0");
  return `${hh}:${mm}`;
}
