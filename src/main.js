import { presetQueries } from './data.js';
import { 
  getNeo4jConfig, 
  saveNeo4jConfig, 
  testConnection, 
  runCypher, 
  fetchFocusedGraph, 
  expandNeighbors 
} from './neo4j.js';

// Application State
const state = {
  currentRoute: 'overview',
  connection: { connected: false, via: null, time: null },
  data: {
    customers: [],
    vehicles: [],
    policies: [],
    claims: [],
    payments: []
  },
  metrics: {
    customers: 0,
    vehicles: 0,
    policies: 0,
    activePolicies: 0,
    claims: 0,
    pendingClaims: 0,
    collectedPremium: 0,
    totalSumInsured: 0
  },
  activeDetail: null, // { type, record }
  graph: {
    nodes: [],
    links: [],
    selectedNode: null,
    scale: 1.0,
    panX: 0,
    panY: 0,
    physics: true,
    draggedNode: null
  },
  queryStudio: {
    selectedQuery: presetQueries[0],
    editorContent: presetQueries[0].cypher,
    results: null,
    loading: false
  },
  searchQuery: '',
  sidebarOpen: false
};

// Routing Table
const routes = {
  overview: { title: 'Overview', group: 'Workspace' },
  customers: { title: 'Customers', group: 'Workspace' },
  vehicles: { title: 'Vehicles', group: 'Workspace' },
  policies: { title: 'Policies', group: 'Workspace' },
  claims: { title: 'Claims', group: 'Workspace' },
  payments: { title: 'Payments', group: 'Workspace' },
  graph: { title: 'Graph Explorer', group: 'Developer Tools' },
  studio: { title: 'Query Studio', group: 'Developer Tools' },
  schema: { title: 'Schema', group: 'Developer Tools' }
};

// ==========================================
// CENTRALIZED DESIGN-SYSTEM FORMATTERS
// ==========================================
function formatCurrency(val) {
  const num = Number(val) || 0;
  return `₹${num.toLocaleString('en-IN')}`;
}

function renderBalanceCell(balance) {
  const num = Number(balance) || 0;
  if (num === 0) {
    return `<span class="text-muted text-mono">₹0</span>`;
  }
  return `<span class="text-mono" style="color: var(--text-primary); font-weight: 500;">₹${num.toLocaleString('en-IN')}</span>`;
}

function renderStatusBadge(status, customLabel) {
  const s = String(status || "UNKNOWN").trim().toUpperCase();
  const cls = s.toLowerCase();
  const label = customLabel || s;
  // Return a simple colored dot with a tooltip showing the status label
  return `<span class="status-dot status-${cls}" title="${label}"></span>`;
}

// 1. Initialize and Fetch Live Data from Neo4j
async function initApp() {
  renderShell();
  setupGlobalShortcuts();
  await checkDatabaseConnection();
  await reloadAllData();
  handleHashNavigation();
  window.addEventListener('hashchange', handleHashNavigation);
}

function handleHashNavigation() {
  const hash = window.location.hash.replace('#/', '').replace('#', '').trim() || 'overview';
  if (routes[hash]) {
    navigate(hash, false);
  }
}

async function checkDatabaseConnection() {
  const status = await testConnection();
  state.connection = status;
  updateConnectionBadge();
}

function updateConnectionBadge() {
  const badge = document.getElementById('headerConnPill');
  if (!badge) return;
  if (state.connection.connected) {
    badge.className = 'conn-pill connected';
    badge.innerHTML = `<span class="conn-dot"></span><span>Neo4j Live</span>`;
  } else {
    badge.className = 'conn-pill disconnected';
    badge.innerHTML = `<span class="conn-dot"></span><span>Disconnected</span>`;
  }
}

// Reload all primary entities via Cypher queries
async function reloadAllData() {
  try {
    // 1. Fetch Customers with phone arrays & vehicle count
    const custRes = await runCypher(`
      MATCH (c:Customer)
      OPTIONAL MATCH (c)-[:OWNS]->(v:Vehicle)
      RETURN c, count(v) AS vehicle_count
      ORDER BY c.customer_id;
    `);
    state.data.customers = custRes.rows.map(r => ({
      ...r.c,
      vehicle_count: r.vehicle_count || 0
    }));

    // 2. Fetch Vehicles with Owner Name & Policy
    const vehRes = await runCypher(`
      MATCH (v:Vehicle)
      OPTIONAL MATCH (c:Customer)-[:OWNS]->(v)
      OPTIONAL MATCH (v)-[:INSURED_BY]->(p:Policy)
      RETURN v, c.name AS owner_name, c.customer_id AS customer_id, p.policy_id AS policy_id, p.policy_status AS policy_status
      ORDER BY v.vehicle_id;
    `);
    state.data.vehicles = vehRes.rows.map(r => ({
      ...r.v,
      owner_name: r.owner_name || 'Unassigned',
      customer_id: r.customer_id,
      policy_id: r.policy_id,
      policy_status: r.policy_status || 'UNINSURED'
    }));

    // 3. Fetch Policies with Vehicle Reg and Paid amounts
    const polRes = await runCypher(`
      MATCH (p:Policy)
      OPTIONAL MATCH (v:Vehicle)-[:INSURED_BY]->(p)
      OPTIONAL MATCH (p)-[:PAID_THROUGH]->(pay:Payment)
      RETURN p, v.reg_no AS vehicle_reg, v.vehicle_id AS vehicle_id, coalesce(sum(pay.amount), 0) AS total_paid
      ORDER BY p.policy_id;
    `);
    state.data.policies = polRes.rows.map(r => {
      const prem = Number(r.p.premium_amount) || 0;
      const paid = Number(r.total_paid) || 0;
      return {
        ...r.p,
        vehicle_reg: r.vehicle_reg || 'N/A',
        vehicle_id: r.vehicle_id,
        total_paid: paid,
        balance: Math.max(0, prem - paid)
      };
    });

    // 4. Fetch Claims with Policy and Vehicle Reg
    const claimRes = await runCypher(`
      MATCH (cl:Claim)
      OPTIONAL MATCH (p:Policy)-[:GENERATES]->(cl)
      OPTIONAL MATCH (v:Vehicle)-[:INSURED_BY]->(p)
      OPTIONAL MATCH (c:Customer)-[:OWNS]->(v)
      OPTIONAL MATCH (cl)-[:HAS_DOCUMENT]->(d:ClaimDocument)
      RETURN cl, p.policy_id AS policy_id, v.reg_no AS vehicle_reg, c.name AS customer_name, count(d) AS doc_count
      ORDER BY cl.claim_id;
    `);
    state.data.claims = claimRes.rows.map(r => ({
      ...r.cl,
      policy_id: r.policy_id,
      vehicle_reg: r.vehicle_reg || 'N/A',
      customer_name: r.customer_name || 'N/A',
      doc_count: r.doc_count || 0
    }));

    // 5. Fetch Payments with Receipts
    const payRes = await runCypher(`
      MATCH (pay:Payment)
      OPTIONAL MATCH (p:Policy)-[:PAID_THROUGH]->(pay)
      OPTIONAL MATCH (pay)-[:HAS_RECEIPT]->(r:PaymentReceipt)
      RETURN pay, p.policy_id AS policy_id, r.receipt_file AS receipt_file
      ORDER BY pay.payment_id;
    `);
    state.data.payments = payRes.rows.map(r => ({
      ...r.pay,
      policy_id: r.policy_id,
      receipt_file: r.receipt_file || null
    }));

    // Compute Metrics
    state.metrics.customers = state.data.customers.length;
    state.metrics.vehicles = state.data.vehicles.length;
    state.metrics.policies = state.data.policies.length;
    state.metrics.activePolicies = state.data.policies.filter(p => p.policy_status === 'ACTIVE').length;
    state.metrics.claims = state.data.claims.length;
    state.metrics.pendingClaims = state.data.claims.filter(c => c.claim_status === 'PENDING').length;
    state.metrics.collectedPremium = state.data.payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    state.metrics.totalSumInsured = state.data.policies.reduce((sum, p) => sum + (Number(p.sum_insured) || 0), 0);

    renderCurrentRoute();
  } catch (err) {
    console.error('Failed to load database records from Neo4j:', err);
    showToast(`Error connecting to database: ${err.message}`);
  }
}

// 2. Render Application Shell
function renderShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="app-layout">
      <!-- Sidebar -->
      <aside class="app-sidebar" id="sidebar">
        <div class="sidebar-header">
          <div class="sidebar-brand-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <span class="sidebar-brand-name">Insurance DBMS</span>
        </div>

        <div class="sidebar-content">
          <!-- Workspace -->
          <div>
            <div class="nav-group-title">Workspace</div>
            <nav style="display: flex; flex-direction: column; gap: 0.15rem;">
              <a class="nav-item ${state.currentRoute === 'overview' ? 'active' : ''}" data-route="overview">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                Overview
              </a>
              <a class="nav-item ${state.currentRoute === 'customers' ? 'active' : ''}" data-route="customers">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                Customers
              </a>
              <a class="nav-item ${state.currentRoute === 'vehicles' ? 'active' : ''}" data-route="vehicles">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="8" rx="2"/><path d="M6 11V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5"/><circle cx="7.5" cy="15.5" r="1.5"/><circle cx="16.5" cy="15.5" r="1.5"/></svg>
                Vehicles
              </a>
              <a class="nav-item ${state.currentRoute === 'policies' ? 'active' : ''}" data-route="policies">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                Policies
              </a>
              <a class="nav-item ${state.currentRoute === 'claims' ? 'active' : ''}" data-route="claims">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                Claims
              </a>
              <a class="nav-item ${state.currentRoute === 'payments' ? 'active' : ''}" data-route="payments">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                Payments
              </a>
            </nav>
          </div>

          <!-- Developer Tools -->
          <div>
            <div class="nav-group-title">Developer Tools</div>
            <nav style="display: flex; flex-direction: column; gap: 0.15rem;">
              <a class="nav-item ${state.currentRoute === 'graph' ? 'active' : ''}" data-route="graph">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M6 9v6M9 6h6M9 18h6M18 9v6"/></svg>
                Graph Explorer
              </a>
              <a class="nav-item ${state.currentRoute === 'studio' ? 'active' : ''}" data-route="studio">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                Query Studio
              </a>
              <a class="nav-item ${state.currentRoute === 'schema' ? 'active' : ''}" data-route="schema">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                Schema
              </a>
            </nav>
          </div>
        </div>

        <div class="sidebar-footer">
          <span>BACSE202 DA3</span>
          <span style="font-family: var(--font-mono); font-size: 11px;">Neo4j AuraDB</span>
        </div>
      </aside>

      <!-- Main Surface -->
      <div class="app-main">
        <!-- Header -->
        <header class="app-header">
          <div class="header-left">
            <button class="mobile-menu-btn" id="btnToggleMobileMenu">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <div class="header-breadcrumbs">
              <span id="breadcrumbGroup">Workspace</span>
              <span>/</span>
              <span class="breadcrumb-active" id="breadcrumbPage">Overview</span>
            </div>
          </div>

          <div class="header-right">
            <!-- Search trigger -->
            <button class="search-trigger" id="btnOpenSearch">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <span>Quick search...</span>
              <kbd class="search-kbd">⌘K</kbd>
            </button>

            <!-- Neo4j Status Badge -->
            <button class="conn-pill" id="headerConnPill" title="Click to view database connection details">
              <span class="conn-dot"></span>
              <span>Checking...</span>
            </button>

            <!-- Refresh Button -->
            <button class="btn btn-ghost" id="btnGlobalRefresh" title="Refresh all database data">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            </button>

            <!-- Settings Button -->

          </div>
        </header>

        <!-- Dynamic Page Container -->
        <main class="page-container" id="mainContainer"></main>
      </div>
    </div>

    <!-- Slide-over Record Detail Drawer -->
    <div class="drawer-overlay" id="drawerOverlay"></div>
    <div class="drawer-panel" id="detailDrawer">
      <div class="drawer-header">
        <div>
          <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-tertiary);" id="drawerEntityBadge">Detail</div>
          <div style="font-size: 15px; font-weight: 600; color: var(--text-primary);" id="drawerTitle">Record Information</div>
        </div>
        <button class="btn btn-ghost" id="btnCloseDrawer" style="padding: 0.35rem;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="drawer-body" id="drawerBody"></div>
    </div>

    <!-- Command Palette (⌘K) Modal -->
    <div class="modal-overlay" id="searchModal">
      <div class="cmd-dialog">
        <div class="cmd-input-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" class="cmd-input" id="cmdInput" placeholder="Search customer, vehicle registration, policy ID, or claim..." />
          <kbd class="search-kbd">ESC</kbd>
        </div>
        <div class="cmd-results" id="cmdResults">
          <div style="padding: 1.5rem; text-align: center; color: var(--text-tertiary); font-size: 13px;">
            Type at least 2 characters to search across all insurance entities...
          </div>
        </div>
      </div>
    </div>



    <!-- Create Customer Modal -->
    <div class="modal-overlay" id="addCustomerModal">
      <div class="modal-dialog">
        <div class="modal-header">
          <div style="font-size: 15px; font-weight: 600;">Register New Customer</div>
          <button class="btn btn-ghost" id="btnCloseAddCustomer" style="padding: 0.35rem;" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form id="formCreateCustomer">
          <div class="modal-body" style="display: flex; flex-direction: column; gap: 0.85rem;">
            <div>
              <label style="font-size: 12px; font-weight: 500; color: var(--text-secondary); display: block; margin-bottom: 0.3rem;">Full Name *</label>
              <input type="text" id="modalCustName" class="input-text" style="width: 100%;" required placeholder="e.g. Anand Kumar" />
            </div>
            <div>
              <label style="font-size: 12px; font-weight: 500; color: var(--text-secondary); display: block; margin-bottom: 0.3rem;">Email Address *</label>
              <input type="email" id="modalCustEmail" class="input-text" style="width: 100%;" required placeholder="anand.kumar@mail.com" />
            </div>
            <div>
              <label style="font-size: 12px; font-weight: 500; color: var(--text-secondary); display: block; margin-bottom: 0.3rem;">Driving License Number *</label>
              <input type="text" id="modalCustLicense" class="input-text" style="width: 100%; font-family: var(--font-mono);" required placeholder="TN0920220019283" />
            </div>
            <div>
              <label style="font-size: 12px; font-weight: 500; color: var(--text-secondary); display: block; margin-bottom: 0.3rem;">Address</label>
              <input type="text" id="modalCustAddress" class="input-text" style="width: 100%;" placeholder="42 Beach Road, Chennai" />
            </div>
            <div>
              <label style="font-size: 12px; font-weight: 500; color: var(--text-secondary); display: block; margin-bottom: 0.3rem;">Phone Number</label>
              <input type="text" id="modalCustPhone" class="input-text" style="width: 100%; font-family: var(--font-mono);" placeholder="9876543210" />
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" id="btnCancelAddCustomer">Cancel</button>
            <button type="submit" class="btn btn-primary">+ Create in Neo4j</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Toast Notification -->
    <div class="toast-bar" id="toastBar">Action completed</div>
  `;

  setupShellEventListeners();
}

// 3. Navigation Controller
function navigate(route, updateHistory = true) {
  if (!routes[route]) route = 'overview';
  state.currentRoute = route;

  if (updateHistory) {
    window.location.hash = `#/${route}`;
  }

  // Update Breadcrumbs
  document.getElementById('breadcrumbGroup').innerText = routes[route].group;
  document.getElementById('breadcrumbPage').innerText = routes[route].title;

  // Update Sidebar active state
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.route === route);
  });

  // Close mobile sidebar if open
  state.sidebarOpen = false;
  document.getElementById('sidebar')?.classList.remove('open');

  renderCurrentRoute();
}

function renderCurrentRoute() {
  const container = document.getElementById('mainContainer');
  if (!container) return;

  switch (state.currentRoute) {
    case 'overview':
      renderOverviewPage(container);
      break;
    case 'customers':
      renderCustomersPage(container);
      break;
    case 'vehicles':
      renderVehiclesPage(container);
      break;
    case 'policies':
      renderPoliciesPage(container);
      break;
    case 'claims':
      renderClaimsPage(container);
      break;
    case 'payments':
      renderPaymentsPage(container);
      break;
    case 'graph':
      renderGraphExplorerPage(container);
      break;
    case 'studio':
      renderQueryStudioPage(container);
      break;
    case 'schema':
      renderSchemaPage(container);
      break;
    default:
      renderOverviewPage(container);
  }
}

// ==========================================
// VIEW 1: OVERVIEW DASHBOARD
// ==========================================
function renderOverviewPage(container) {
  const m = state.metrics;

  container.innerHTML = `
    <div class="page-header-row">
      <div>
        <h1 class="page-title">Overview</h1>
        <p class="page-desc">Production insurance graph database containing customers, registered vehicles, policies, claims, and settlement payments.</p>
      </div>
      <div style="display: flex; gap: 0.5rem;">
        <button class="btn btn-secondary" id="btnOverviewRunQuery">Run Cypher</button>
        <button class="btn btn-primary" id="btnOverviewNewCustomer">+ Add Customer</button>
      </div>
    </div>

    <!-- 5 Compact Metrics -->
    <section class="metrics-row">
      <div class="metric-card" data-nav="customers">
        <span class="metric-label">Total Customers</span>
        <span class="metric-value font-mono">${m.customers}</span>
        <span class="metric-meta">Unique policyholders</span>
      </div>
      <div class="metric-card" data-nav="vehicles">
        <span class="metric-label">Registered Vehicles</span>
        <span class="metric-value font-mono">${m.vehicles}</span>
        <span class="metric-meta">Petrol, Diesel, EV, CNG</span>
      </div>
      <div class="metric-card" data-nav="policies">
        <span class="metric-label">Active Policies</span>
        <span class="metric-value font-mono">${m.activePolicies} <span style="font-size: 1rem; color: var(--text-tertiary); font-weight: 400;">/ ${m.policies}</span></span>
        <span class="metric-meta">${formatCurrency(m.totalSumInsured)} total coverage</span>
      </div>
      <div class="metric-card" data-nav="claims">
        <span class="metric-label">Total Claims</span>
        <span class="metric-value font-mono">${m.claims}</span>
        <span class="metric-meta">${m.pendingClaims} pending review</span>
      </div>
      <div class="metric-card" data-nav="payments">
        <span class="metric-label">Collected Premium</span>
        <span class="metric-value font-mono">${formatCurrency(m.collectedPremium)}</span>
        <span class="metric-meta">Total verified receipts</span>
      </div>
    </section>

    <!-- Two-Column Overview Layout -->
    <div class="overview-grid">
      <!-- Pending Claims -->
      <div class="card-section">
        <div class="card-section-header">
          <span class="section-title">Pending Claims Requiring Attention</span>
          <button class="btn btn-ghost" data-nav="claims" style="font-size: 12px; padding: 0.2rem 0.5rem;">View All →</button>
        </div>
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Claim ID</th>
                <th>Vehicle</th>
                <th class="num-col">Amount</th>
                <th>Status</th>
                <th class="center-col">Action</th>
              </tr>
            </thead>
            <tbody>
              ${state.data.claims.filter(c => c.claim_status === 'PENDING').map(c => `
                <tr data-type="Claim" data-id="${c.claim_id}">
                  <td class="text-mono font-medium">#${c.claim_id}</td>
                  <td>${c.vehicle_reg}</td>
                  <td class="num-col">${formatCurrency(c.claim_amount)}</td>
                  <td>${renderStatusBadge(c.claim_status)}</td>
                  <td class="center-col">
                    <button class="btn btn-secondary btn-quick-approve" data-claim-id="${c.claim_id}" style="font-size: 11px; padding: 0.2rem 0.5rem;">
                      Approve
                    </button>
                  </td>
                </tr>
              `).join('') || `<tr><td colspan="5" style="color: var(--text-tertiary); text-align: center; padding: 2rem;">No pending claims.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Expiring / Attention Policies -->
      <div class="card-section">
        <div class="card-section-header">
          <span class="section-title">Policies Requiring Renewal</span>
          <button class="btn btn-ghost" data-nav="policies" style="font-size: 12px; padding: 0.2rem 0.5rem;">View All →</button>
        </div>
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Policy ID</th>
                <th>Type</th>
                <th>Vehicle</th>
                <th>Expiry</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${state.data.policies.slice(0, 5).map(p => `
                <tr data-type="Policy" data-id="${p.policy_id}">
                  <td class="text-mono font-medium">#${p.policy_id}</td>
                  <td>${p.policy_type}</td>
                  <td class="text-mono">${p.vehicle_reg}</td>
                  <td class="text-mono text-muted">${p.end_date}</td>
                  <td>${renderStatusBadge(p.policy_status)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Recent Policyholders -->
    <div class="card-section">
      <div class="card-section-header">
        <span class="section-title">Recent Registered Policyholders</span>
        <button class="btn btn-ghost" data-nav="customers" style="font-size: 12px; padding: 0.2rem 0.5rem;">View Customers →</button>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Customer ID</th>
              <th>Name</th>
              <th>Email</th>
              <th>Driving License</th>
              <th>Owned Vehicles</th>
              <th class="center-col">Action</th>
            </tr>
          </thead>
          <tbody>
            ${state.data.customers.slice(0, 5).map(c => `
              <tr data-type="Customer" data-id="${c.customer_id}">
                <td class="text-mono">#${c.customer_id}</td>
                <td style="font-weight: 500;">${c.name}</td>
                <td style="color: var(--text-secondary);">${c.email}</td>
                <td class="text-mono">${c.license_no}</td>
                <td><span class="badge badge-neutral">${c.vehicle_count} vehicles</span></td>
                <td class="center-col"><button class="btn btn-ghost" style="font-size: 11px;">View</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Attach Overview Listeners
  container.querySelectorAll('.metric-card, [data-nav]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      navigate(el.dataset.nav);
    });
  });

  document.getElementById('btnOverviewNewCustomer')?.addEventListener('click', () => {
    openModal('addCustomerModal');
  });

  document.getElementById('btnOverviewRunQuery')?.addEventListener('click', () => {
    navigate('studio');
  });

  container.querySelectorAll('tbody tr[data-type]').forEach(row => {
    row.addEventListener('click', () => {
      openRecordDetail(row.dataset.type, row.dataset.id);
    });
  });

  container.querySelectorAll('.btn-quick-approve').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const claimId = parseInt(btn.dataset.claimId);
      await updateClaimStatus(claimId, 'APPROVED');
    });
  });
}

// ==========================================
// VIEW 2: CUSTOMERS TABLE PAGE
// ==========================================
function renderCustomersPage(container) {
  let filter = '';

  function renderTable() {
    const filtered = state.data.customers.filter(c => 
      !filter || 
      c.name.toLowerCase().includes(filter) ||
      c.email.toLowerCase().includes(filter) ||
      c.license_no.toLowerCase().includes(filter) ||
      String(c.customer_id).includes(filter)
    );

    const tbody = container.querySelector('#custTableBody');
    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 3rem; color: var(--text-tertiary);">No customers matching "${filter}".</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(c => `
      <tr data-type="Customer" data-id="${c.customer_id}">
        <td style="font-family: var(--font-mono); color: var(--text-tertiary);">#${c.customer_id}</td>
        <td style="font-weight: 500;">${c.name}</td>
        <td style="color: var(--text-secondary);">${c.email}</td>
        <td style="font-family: var(--font-mono);">${c.license_no}</td>
        <td style="color: var(--text-secondary);">${Array.isArray(c.phones) ? c.phones.join(', ') : (c.phones || 'N/A')}</td>
        <td><span class="badge badge-neutral">${c.vehicle_count} vehicles</span></td>
      </tr>
    `).join('');

    tbody.querySelectorAll('tr').forEach(row => {
      row.onclick = () => openRecordDetail('Customer', row.dataset.id);
    });
  }

  container.innerHTML = `
    <div class="page-header-row">
      <div>
        <h1 class="page-title">Customers</h1>
        <p class="page-desc">Registered insurance policyholders and their connected asset ownership.</p>
      </div>
      <button class="btn btn-primary" id="btnPageAddCustomer">+ Add Customer</button>
    </div>

    <div class="card-section">
      <div class="filter-bar">
        <input type="text" id="custSearchInput" class="input-text table-search-input" placeholder="Search by name, email, or license..." />
        <span style="font-size: 12px; color: var(--text-tertiary); margin-left: auto;">
          ${state.data.customers.length} total records
        </span>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Customer Name</th>
              <th>Email</th>
              <th>Driving License</th>
              <th>Phone</th>
              <th>Vehicles</th>
            </tr>
          </thead>
          <tbody id="custTableBody"></tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btnPageAddCustomer')?.addEventListener('click', () => openModal('addCustomerModal'));
  const input = container.querySelector('#custSearchInput');
  input.addEventListener('input', (e) => {
    filter = e.target.value.toLowerCase().trim();
    renderTable();
  });

  renderTable();
}

// ==========================================
// VIEW 3: VEHICLES TABLE PAGE
// ==========================================
function renderVehiclesPage(container) {
  let search = '';
  let fuelFilter = 'ALL';

  function renderTable() {
    const filtered = state.data.vehicles.filter(v => {
      const matchSearch = !search || 
        v.reg_no.toLowerCase().includes(search) || 
        v.brand.toLowerCase().includes(search) || 
        v.vehicle_model.toLowerCase().includes(search) ||
        v.owner_name.toLowerCase().includes(search);
      const matchFuel = fuelFilter === 'ALL' || v.fuel_type === fuelFilter;
      return matchSearch && matchFuel;
    });

    const tbody = container.querySelector('#vehTableBody');
    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 3rem; color: var(--text-tertiary);">No vehicles found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(v => `
      <tr data-type="Vehicle" data-id="${v.vehicle_id}">
        <td style="font-family: var(--font-mono); font-weight: 500;">${v.reg_no}</td>
        <td>${v.brand} ${v.vehicle_model}</td>
        <td><span class="badge badge-neutral">${v.fuel_type}</span></td>
        <td style="font-family: var(--font-mono);">${v.mfg_year}</td>
        <td>${v.owner_name}</td>
        <td style="font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary);">
          ${v.policy_id ? `Policy #${v.policy_id}` : '<span class="text-muted">—</span>'}
        </td>
        <td>
          ${v.policy_id ? renderStatusBadge(v.policy_status) : `<span class="badge badge-neutral"><span class="badge-dot"></span>UNINSURED</span>`}
        </td>
        <td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-tertiary);">${v.chassis_no}</td>
      </tr>
    `).join('');

    tbody.querySelectorAll('tr').forEach(row => {
      row.onclick = () => openRecordDetail('Vehicle', row.dataset.id);
    });
  }

  container.innerHTML = `
    <div class="page-header-row">
      <div>
        <h1 class="page-title">Vehicles</h1>
        <p class="page-desc">Automotive asset registry mapped to customer owners and active insurance policies.</p>
      </div>
    </div>

    <div class="card-section">
      <div class="filter-bar">
        <input type="text" id="vehSearchInput" class="input-text table-search-input" placeholder="Search registration, brand, owner..." />
        <select id="vehFuelSelect" class="select-dropdown">
          <option value="ALL">All Fuel Types</option>
          <option value="PETROL">Petrol</option>
          <option value="DIESEL">Diesel</option>
          <option value="ELECTRIC">Electric</option>
          <option value="CNG">CNG</option>
        </select>
        <span style="font-size: 12px; color: var(--text-tertiary); margin-left: auto;">
          ${state.data.vehicles.length} vehicles registered
        </span>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Registration No</th>
              <th>Make & Model</th>
              <th>Fuel</th>
              <th>Year</th>
              <th>Registered Owner</th>
              <th>Linked Policy</th>
              <th>Insurance Status</th>
              <th>Chassis No</th>
            </tr>
          </thead>
          <tbody id="vehTableBody"></tbody>
        </table>
      </div>
    </div>
  `;

  container.querySelector('#vehSearchInput').addEventListener('input', (e) => {
    search = e.target.value.toLowerCase().trim();
    renderTable();
  });
  container.querySelector('#vehFuelSelect').addEventListener('change', (e) => {
    fuelFilter = e.target.value;
    renderTable();
  });

  renderTable();
}

// ==========================================
// VIEW 4: POLICIES TABLE PAGE
// ==========================================
function renderPoliciesPage(container) {
  let statusFilter = 'ALL';

  function renderTable() {
    const filtered = state.data.policies.filter(p => {
      return statusFilter === 'ALL' || p.policy_status === statusFilter;
    });

    const tbody = container.querySelector('#polTableBody');
    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 3rem; color: var(--text-tertiary);">No policies found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(p => `
      <tr data-type="Policy" data-id="${p.policy_id}">
        <td style="font-family: var(--font-mono); font-weight: 500;">#${p.policy_id}</td>
        <td>${p.policy_type}</td>
        <td style="font-family: var(--font-mono);">${p.vehicle_reg}</td>
        <td class="num-col">${formatCurrency(p.premium_amount)}</td>
        <td class="num-col">${formatCurrency(p.sum_insured)}</td>
        <td style="font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary);">${p.start_date} → ${p.end_date}</td>
        <td>${renderStatusBadge(p.policy_status)}</td>
        <td class="num-col">${renderBalanceCell(p.balance)}</td>
      </tr>
    `).join('');

    tbody.querySelectorAll('tr').forEach(row => {
      row.onclick = () => openRecordDetail('Policy', row.dataset.id);
    });
  }

  container.innerHTML = `
    <div class="page-header-row">
      <div>
        <h1 class="page-title">Insurance Policies</h1>
        <p class="page-desc">Comprehensive, Third-Party, and Own-Damage coverage policies and financial obligations.</p>
      </div>
    </div>

    <div class="card-section">
      <div class="filter-bar">
        <select id="polStatusSelect" class="select-dropdown">
          <option value="ALL">All Statuses</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="EXPIRED">EXPIRED</option>
          <option value="CANCELLED">CANCELLED</option>
        </select>
        <span style="font-size: 12px; color: var(--text-tertiary); margin-left: auto;">
          ${state.data.policies.length} policies recorded
        </span>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Policy ID</th>
              <th>Type</th>
              <th>Vehicle</th>
              <th class="num-col">Annual Premium</th>
              <th class="num-col">Sum Insured</th>
              <th>Period</th>
              <th>Status</th>
              <th class="num-col">Balance Due</th>
            </tr>
          </thead>
          <tbody id="polTableBody"></tbody>
        </table>
      </div>
    </div>
  `;

  container.querySelector('#polStatusSelect').addEventListener('change', (e) => {
    statusFilter = e.target.value;
    renderTable();
  });

  renderTable();
}

// ==========================================
// VIEW 5: CLAIMS TABLE PAGE
// ==========================================
function renderClaimsPage(container) {
  let statusFilter = 'ALL';

  function renderTable() {
    const filtered = state.data.claims.filter(c => statusFilter === 'ALL' || c.claim_status === statusFilter);
    const tbody = container.querySelector('#claimTableBody');
    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 3rem; color: var(--text-tertiary);">No claims found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(c => `
      <tr data-type="Claim" data-id="${c.claim_id}">
        <td style="font-family: var(--font-mono); font-weight: 500;">#${c.claim_id}</td>
        <td style="font-family: var(--font-mono); color: var(--text-secondary);">Policy #${c.policy_id}</td>
        <td>${c.customer_name}</td>
        <td class="num-col">${formatCurrency(c.claim_amount)}</td>
        <td style="font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary);">${c.claim_date}</td>
        <td>${renderStatusBadge(c.claim_status)}</td>
        <td><span class="badge badge-neutral">${c.doc_count} docs</span></td>
        <td style="text-align: right;">
          <button class="btn btn-ghost" style="font-size: 11px; padding: 0.25rem 0.5rem;">Inspect →</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('tr').forEach(row => {
      row.onclick = () => openRecordDetail('Claim', row.dataset.id);
    });
  }

  container.innerHTML = `
    <div class="page-header-row">
      <div>
        <h1 class="page-title">Claims Management</h1>
        <p class="page-desc">Adjudication tracking for submitted loss and accident reimbursement requests.</p>
      </div>
    </div>

    <div class="card-section">
      <div class="filter-bar">
        <select id="claimStatusSelect" class="select-dropdown">
          <option value="ALL">All Claim Statuses</option>
          <option value="PENDING">PENDING</option>
          <option value="APPROVED">APPROVED</option>
          <option value="SETTLED">SETTLED</option>
          <option value="REJECTED">REJECTED</option>
        </select>
        <span style="font-size: 12px; color: var(--text-tertiary); margin-left: auto;">
          ${state.data.claims.length} claims logged
        </span>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Claim ID</th>
              <th>Linked Policy</th>
              <th>Claimant</th>
              <th class="num-col">Claim Amount</th>
              <th>Date Filed</th>
              <th>Status</th>
              <th>Attachments</th>
              <th style="text-align: right;">Action</th>
            </tr>
          </thead>
          <tbody id="claimTableBody"></tbody>
        </table>
      </div>
    </div>
  `;

  container.querySelector('#claimStatusSelect').addEventListener('change', (e) => {
    statusFilter = e.target.value;
    renderTable();
  });

  renderTable();
}

// ==========================================
// VIEW 6: PAYMENTS TABLE PAGE
// ==========================================
function renderPaymentsPage(container) {
  container.innerHTML = `
    <div class="page-header-row">
      <div>
        <h1 class="page-title">Premium Payments</h1>
        <p class="page-desc">Audited ledger of policy installments and electronic transaction receipts.</p>
      </div>
    </div>

    <div class="card-section">
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Payment ID</th>
              <th>Policy ID</th>
              <th class="num-col">Amount</th>
              <th>Method</th>
              <th>Payment Date</th>
              <th>Receipt Reference</th>
            </tr>
          </thead>
          <tbody>
            ${state.data.payments.length === 0 ? `
              <tr><td colspan="6" style="text-align: center; padding: 3rem; color: var(--text-tertiary);">No payments recorded.</td></tr>
            ` : state.data.payments.map(p => `
              <tr data-type="Payment" data-id="${p.payment_id}">
                <td style="font-family: var(--font-mono); font-weight: 500;">#${p.payment_id}</td>
                <td style="font-family: var(--font-mono); color: var(--text-secondary);">Policy #${p.policy_id}</td>
                <td class="num-col">${formatCurrency(p.amount)}</td>
                <td><span class="badge badge-neutral">${p.payment_method}</span></td>
                <td style="font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary);">${p.payment_date}</td>
                <td style="font-family: var(--font-mono); font-size: 12px; color: var(--text-tertiary);">${p.receipt_file || 'None'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.querySelectorAll('tbody tr').forEach(row => {
    row.onclick = () => openRecordDetail('Payment', row.dataset.id);
  });
}

// ==========================================
// VIEW 7: FOCUSED GRAPH EXPLORER
// ==========================================
function renderGraphExplorerPage(container) {
  const isEmpty = state.graph.nodes.length === 0;

  container.innerHTML = `
    <div class="page-header-row">
      <div>
        <h1 class="page-title">Graph Explorer</h1>
        <p class="page-desc">Focused exploration of property graph connections. Search any entity to begin.</p>
      </div>
      <div style="display: flex; gap: 0.5rem;">
        <button class="btn btn-secondary" id="btnGraphReset">Clear Graph</button>
      </div>
    </div>

    <div class="graph-explorer-layout">
      <!-- Canvas Box -->
      <div class="graph-canvas-box">
        <!-- Floating Toolbar -->
        <div class="graph-toolbar">
          <button class="btn btn-ghost" id="btnGZoomIn" style="padding: 0.25rem 0.5rem; font-size: 11px;">Zoom +</button>
          <button class="btn btn-ghost" id="btnGZoomOut" style="padding: 0.25rem 0.5rem; font-size: 11px;">Zoom -</button>
          <button class="btn btn-ghost" id="btnGFit" style="padding: 0.25rem 0.5rem; font-size: 11px;">Fit View</button>
          <button class="btn btn-ghost" id="btnGTogglePhysics" style="padding: 0.25rem 0.5rem; font-size: 11px;">Pause Physics</button>
        </div>

        <!-- Entity Search inside Graph -->
        <div class="graph-search-bar">
          <input type="text" id="graphSearchInput" class="input-text" placeholder="Lookup customer, vehicle reg, policy..." style="width: 260px; font-size: 12px;" />
          <button class="btn btn-primary" id="btnGraphSearch" style="padding: 0.35rem 0.65rem; font-size: 12px;">Search</button>
        </div>

        <!-- Clean Initial State Overlay -->
        <div class="graph-empty-state" id="graphEmptyState" style="${isEmpty ? 'display: flex;' : 'display: none;'}">
          <div class="graph-empty-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              <path d="M11 8v6M8 11h6"/>
            </svg>
          </div>
          <div style="font-size: 15px; font-weight: 600; color: var(--text-primary); margin-top: 0.75rem;">
            Search to Explore Graph Connections
          </div>
          <p style="font-size: 13px; color: var(--text-tertiary); max-width: 380px; margin: 0.5rem 0 1.25rem 0; line-height: 1.5;">
            To keep exploration focused, nodes load on demand. Search for any customer, vehicle, or policy above, or click a quick starter:
          </p>
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: center; max-width: 460px;">
            <button class="btn btn-secondary graph-quick-pill" data-query="Arjun Mehta">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 5px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Arjun Mehta
            </button>
            <button class="btn btn-secondary graph-quick-pill" data-query="Vinayak Tripathi">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 5px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Vinayak Tripathi
            </button>
            <button class="btn btn-secondary graph-quick-pill" data-query="TN01AB1234">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 5px;"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C1.4 11.2 1 12 1 13v3c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>
              TN01AB1234
            </button>
            <button class="btn btn-secondary graph-quick-pill" data-query="5001">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 5px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Policy #5001
            </button>
            <button class="btn btn-secondary graph-quick-pill" data-query="9001">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 5px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              Claim #9001
            </button>
          </div>
        </div>

        <canvas id="graphCanvas"></canvas>

        <div class="graph-legend-bar">
          <div class="legend-chip"><span class="legend-dot" style="background: #10b981;"></span> Customer</div>
          <div class="legend-chip"><span class="legend-dot" style="background: #0ea5e9;"></span> Vehicle</div>
          <div class="legend-chip"><span class="legend-dot" style="background: #6366f1;"></span> Policy</div>
          <div class="legend-chip"><span class="legend-dot" style="background: #f43f5e;"></span> Claim</div>
          <div class="legend-chip"><span class="legend-dot" style="background: #a855f7;"></span> Payment</div>
        </div>
      </div>

      <!-- Right-side Graph Inspector -->
      <div class="graph-sidebar-inspector" id="graphInspector">
        <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.75rem;">
          Graph Inspector
        </div>
        <div id="inspectorDetails" style="font-size: 13px; color: var(--text-tertiary); line-height: 1.6;">
          Search for an entity or click any node to inspect properties and expand relationships.
        </div>
      </div>
    </div>
  `;

  initGraphCanvas();

  document.getElementById('btnGraphReset')?.addEventListener('click', () => {
    state.graph.nodes = [];
    state.graph.links = [];
    state.graph.selectedNode = null;
    const emptyState = document.getElementById('graphEmptyState');
    if (emptyState) emptyState.style.display = 'flex';
    document.getElementById('inspectorDetails').innerHTML = 'Graph cleared. Search for an entity to begin.';
  });

  document.getElementById('btnGraphSearch')?.addEventListener('click', () => performGraphSearch());
  document.getElementById('graphSearchInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performGraphSearch();
  });

  document.querySelectorAll('.graph-quick-pill').forEach(btn => {
    btn.onclick = () => {
      const q = btn.dataset.query;
      const inp = document.getElementById('graphSearchInput');
      if (inp) inp.value = q;
      performGraphSearch(q);
    };
  });
}

async function performGraphSearch(explicitQuery) {
  const query = (explicitQuery || document.getElementById('graphSearchInput')?.value || '').trim();
  if (!query) return;

  const qLower = query.toLowerCase();
  const qNum = parseInt(query.replace(/[^0-9]/g, '')) || null;

  // 1. Search Customer
  const cust = state.data.customers.find(c => 
    c.name.toLowerCase().includes(qLower) || 
    c.license_no.toLowerCase().includes(qLower) ||
    (qNum !== null && matchEntityId(c.customer_id, qNum))
  );
  if (cust) {
    const data = await fetchFocusedGraph('Customer', 'customer_id', cust.customer_id);
    loadGraphData(data);
    return;
  }

  // 2. Search Vehicle
  const veh = state.data.vehicles.find(v => 
    v.reg_no.toLowerCase().includes(qLower) || 
    v.brand.toLowerCase().includes(qLower) ||
    v.vehicle_model.toLowerCase().includes(qLower) ||
    (qNum !== null && matchEntityId(v.vehicle_id, qNum))
  );
  if (veh) {
    const data = await fetchFocusedGraph('Vehicle', 'vehicle_id', veh.vehicle_id);
    loadGraphData(data);
    return;
  }

  // 3. Search Policy
  const pol = state.data.policies.find(p => 
    matchEntityId(p.policy_id, query) || 
    (qNum !== null && matchEntityId(p.policy_id, qNum))
  );
  if (pol) {
    const data = await fetchFocusedGraph('Policy', 'policy_id', pol.policy_id);
    loadGraphData(data);
    return;
  }

  // 4. Search Claim
  const cl = state.data.claims.find(c => 
    matchEntityId(c.claim_id, query) || 
    (qNum !== null && matchEntityId(c.claim_id, qNum))
  );
  if (cl) {
    const data = await fetchFocusedGraph('Claim', 'claim_id', cl.claim_id);
    loadGraphData(data);
    return;
  }

  // 5. Search Payment
  const pay = state.data.payments.find(p => 
    matchEntityId(p.payment_id, query) || 
    (qNum !== null && matchEntityId(p.payment_id, qNum))
  );
  if (pay) {
    const data = await fetchFocusedGraph('Payment', 'payment_id', pay.payment_id);
    loadGraphData(data);
    return;
  }

  showToast(`No entity found matching "${query}"`);
}

function loadGraphData({ nodes, links }) {
  const emptyState = document.getElementById('graphEmptyState');
  if (emptyState) emptyState.style.display = 'none';

  // Merge smoothly without duplicate keys
  const existingIds = new Set(state.graph.nodes.map(n => n.id));
  nodes.forEach(n => {
    if (!existingIds.has(n.id)) {
      state.graph.nodes.push(n);
    }
  });

  const existingLinkKeys = new Set(state.graph.links.map(l => `${l.source}->${l.target}`));
  links.forEach(l => {
    const key = `${l.source}->${l.target}`;
    if (!existingLinkKeys.has(key)) {
      state.graph.links.push(l);
    }
  });

  showToast(`Visualizing ${state.graph.nodes.length} nodes and ${state.graph.links.length} relationships`);
}

// Interactive Force Simulation for Canvas
let canvasRef = null;
let ctxRef = null;

function initGraphCanvas() {
  const canvas = document.getElementById('graphCanvas');
  if (!canvas) return;
  canvasRef = canvas;
  ctxRef = canvas.getContext('2d');

  function resize() {
    if (canvas && canvas.parentElement) {
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;
    }
  }
  resize();
  window.addEventListener('resize', resize);

  const g = state.graph;

  document.getElementById('btnGZoomIn').onclick = () => { g.scale = Math.min(3.0, g.scale * 1.2); };
  document.getElementById('btnGZoomOut').onclick = () => { g.scale = Math.max(0.3, g.scale / 1.2); };
  document.getElementById('btnGFit').onclick = () => { g.scale = 1.0; g.panX = 0; g.panY = 0; };
  document.getElementById('btnGTogglePhysics').onclick = (e) => {
    g.physics = !g.physics;
    e.target.innerText = g.physics ? 'Pause Physics' : 'Resume Physics';
  };

  let isPanning = false;
  let lastX = 0, lastY = 0;

  canvas.onmousedown = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - g.panX) / g.scale;
    const y = (e.clientY - rect.top - g.panY) / g.scale;

    for (let i = g.nodes.length - 1; i >= 0; i--) {
      const n = g.nodes[i];
      const dx = x - n.x;
      const dy = y - n.y;
      if (Math.sqrt(dx * dx + dy * dy) <= n.radius) {
        g.draggedNode = n;
        g.selectedNode = n;
        inspectGraphNode(n);
        return;
      }
    }

    isPanning = true;
    lastX = e.clientX;
    lastY = e.clientY;
  };

  window.onmousemove = (e) => {
    if (g.draggedNode && canvas) {
      const rect = canvas.getBoundingClientRect();
      g.draggedNode.x = (e.clientX - rect.left - g.panX) / g.scale;
      g.draggedNode.y = (e.clientY - rect.top - g.panY) / g.scale;
    } else if (isPanning) {
      g.panX += e.clientX - lastX;
      g.panY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  };

  window.onmouseup = () => {
    g.draggedNode = null;
    isPanning = false;
  };

  canvas.onwheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    g.scale = Math.min(Math.max(0.2, g.scale * factor), 3.0);
  };

  requestAnimationFrame(tickGraph);
}

function tickGraph() {
  const g = state.graph;
  if (canvasRef && ctxRef && state.currentRoute === 'graph') {
    if (g.physics) {
      // Repulsion
      for (let i = 0; i < g.nodes.length; i++) {
        for (let j = i + 1; j < g.nodes.length; j++) {
          const n1 = g.nodes[i];
          const n2 = g.nodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist < 150) {
            const force = (150 - dist) / dist * 0.08;
            n1.vx -= dx * force;
            n1.vy -= dy * force;
            n2.vx += dx * force;
            n2.vy += dy * force;
          }
        }
      }

      // Links spring
      g.links.forEach(l => {
        const s = g.nodes.find(n => n.id === l.source);
        const t = g.nodes.find(n => n.id === l.target);
        if (s && t) {
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (dist - 100) * 0.015;
          s.vx += (dx / dist) * force;
          s.vy += (dy / dist) * force;
          t.vx -= (dx / dist) * force;
          t.vy -= (dy / dist) * force;
        }
      });

      // Gravity towards center
      const cx = canvasRef.width / 2;
      const cy = canvasRef.height / 2;
      g.nodes.forEach(n => {
        if (n !== g.draggedNode) {
          n.vx += (cx - n.x) * 0.0003;
          n.vy += (cy - n.y) * 0.0003;
          n.vx *= 0.88;
          n.vy *= 0.88;
          n.x += n.vx;
          n.y += n.vy;
        }
      });
    }

    drawGraphCanvas();
  }
  requestAnimationFrame(tickGraph);
}

function drawGraphCanvas() {
  const g = state.graph;
  ctxRef.clearRect(0, 0, canvasRef.width, canvasRef.height);

  ctxRef.save();
  ctxRef.translate(g.panX, g.panY);
  ctxRef.scale(g.scale, g.scale);

  // Draw Edges
  g.links.forEach(l => {
    const s = g.nodes.find(n => n.id === l.source);
    const t = g.nodes.find(n => n.id === l.target);
    if (s && t) {
      ctxRef.beginPath();
      ctxRef.moveTo(s.x, s.y);
      ctxRef.lineTo(t.x, t.y);
      ctxRef.strokeStyle = '#222222';
      ctxRef.lineWidth = 1.2;
      ctxRef.stroke();

      const midX = (s.x + t.x) / 2;
      const midY = (s.y + t.y) / 2;
      ctxRef.fillStyle = '#666666';
      ctxRef.font = '9px "Geist Mono", monospace';
      ctxRef.fillText(l.label, midX - 10, midY - 3);
    }
  });

  // Draw Nodes
  g.nodes.forEach(n => {
    if (g.selectedNode && g.selectedNode.id === n.id) {
      ctxRef.beginPath();
      ctxRef.arc(n.x, n.y, n.radius + 4, 0, Math.PI * 2);
      ctxRef.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctxRef.fill();
    }

    ctxRef.beginPath();
    ctxRef.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
    ctxRef.fillStyle = n.color;
    ctxRef.fill();

    ctxRef.strokeStyle = '#ffffff';
    ctxRef.lineWidth = 1;
    ctxRef.stroke();

    ctxRef.fillStyle = '#ededed';
    ctxRef.font = '11px "Geist", sans-serif';
    ctxRef.textAlign = 'center';
    ctxRef.fillText(n.label, n.x, n.y + n.radius + 12);
  });

  ctxRef.restore();
}

function inspectGraphNode(node) {
  const container = document.getElementById('inspectorDetails');
  if (!container) return;

  const connectedLinks = state.graph.links.filter(l => l.source === node.id || l.target === node.id);

  let idProp = 'customer_id';
  let idVal = node.data.customer_id;
  if (node.type === 'Vehicle') { idProp = 'vehicle_id'; idVal = node.data.vehicle_id; }
  else if (node.type === 'Policy') { idProp = 'policy_id'; idVal = node.data.policy_id; }
  else if (node.type === 'Claim') { idProp = 'claim_id'; idVal = node.data.claim_id; }
  else if (node.type === 'Payment') { idProp = 'payment_id'; idVal = node.data.payment_id; }

  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
      <span class="badge" style="background: ${node.color}22; color: ${node.color}; border-color: ${node.color}44;">
        ${node.type}
      </span>
      <button class="btn btn-secondary" id="btnExpandNodeNeighbors" style="font-size: 11px; padding: 0.25rem 0.5rem;">
        + Expand Neighbors
      </button>
    </div>

    <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 0.25rem;">${node.label}</div>
    <div style="font-size: 12px; color: var(--text-tertiary); margin-bottom: 1rem;">ID: ${node.id}</div>

    <div style="font-size: 11px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 0.4rem;">Properties</div>
    <div style="background: var(--bg-surface-secondary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 0.65rem; font-family: var(--font-mono); font-size: 11px; display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1rem;">
      ${Object.entries(node.data).map(([k, v]) => `
        <div style="display: flex; justify-content: space-between;">
          <span style="color: var(--text-tertiary);">${k}:</span>
          <span style="color: var(--text-primary);">${Array.isArray(v) ? v.join(', ') : v}</span>
        </div>
      `).join('')}
    </div>

    <div style="font-size: 11px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 0.4rem;">Connected Relationships (${connectedLinks.length})</div>
    <div style="display: flex; flex-direction: column; gap: 0.3rem;">
      ${connectedLinks.map(l => `
        <div style="font-size: 11px; font-family: var(--font-mono); color: var(--text-secondary); background: var(--bg-surface-hover); padding: 0.35rem 0.5rem; border-radius: 4px;">
          ${l.source === node.id ? `→ [:${l.label}] → ${l.target}` : `← [:${l.label}] ← ${l.source}`}
        </div>
      `).join('') || '<div style="color: var(--text-tertiary); font-size: 12px;">No relationships loaded yet.</div>'}
    </div>
  `;

  document.getElementById('btnExpandNodeNeighbors')?.addEventListener('click', async () => {
    if (idVal !== undefined) {
      const more = await expandNeighbors(node.type, idProp, idVal);
      loadGraphData(more);
    }
  });
}

// ==========================================
// VIEW 8: QUERY STUDIO
// ==========================================
function renderQueryStudioPage(container) {
  const qs = state.queryStudio;

  container.innerHTML = `
    <div class="page-header-row">
      <div>
        <h1 class="page-title">Query Studio</h1>
        <p class="page-desc">Execute declarative Cypher queries directly against your Neo4j database over Bolt.</p>
      </div>
      <button class="btn btn-primary" id="btnRunStudioQuery">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Run Query (⌘↵)
      </button>
    </div>

    <div class="studio-layout">
      <!-- Query Presets Library -->
      <div class="studio-sidebar">
        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 0.4rem;">
          Saved Queries
        </div>
        ${presetQueries.map(pq => `
          <div class="query-preset-item ${qs.selectedQuery.id === pq.id ? 'active' : ''}" data-pq-id="${pq.id}">
            <div style="font-size: 10px; font-weight: 600; text-transform: uppercase; color: var(--text-tertiary);">${pq.category}</div>
            <div style="font-size: 13px; font-weight: 500; color: var(--text-primary); margin-top: 0.15rem;">${pq.title}</div>
          </div>
        `).join('')}
      </div>

      <!-- Editor & Results -->
      <div class="studio-editor-area">
        <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.65rem;">
            <span style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-tertiary);">Cypher Editor</span>
            <span style="font-size: 11px; font-family: var(--font-mono); color: var(--text-tertiary);">openCypher 5.x</span>
          </div>
          <textarea id="cypherTextarea" class="code-editor-box" style="width: 100%; resize: vertical;" spellcheck="false">${qs.editorContent}</textarea>
        </div>

        <!-- Query Output Table -->
        <div class="card-section" style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
          <div class="card-section-header">
            <span class="section-title">Execution Results</span>
            <span id="queryStudioMeta" style="font-size: 12px; color: var(--text-tertiary); font-family: var(--font-mono);">
              ${qs.results ? `${qs.results.rows.length} rows returned in ${qs.results.duration}ms` : 'Ready to execute'}
            </span>
          </div>
          <div class="table-wrapper" style="flex: 1; overflow-y: auto;" id="studioResultsTableBox">
            ${renderQueryResultsTable(qs.results)}
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach Preset Selectors
  container.querySelectorAll('.query-preset-item').forEach(el => {
    el.addEventListener('click', () => {
      const pq = presetQueries.find(q => q.id === el.dataset.pqId);
      if (pq) {
        qs.selectedQuery = pq;
        qs.editorContent = pq.cypher;
        document.getElementById('cypherTextarea').value = pq.cypher;
        container.querySelectorAll('.query-preset-item').forEach(i => i.classList.remove('active'));
        el.classList.add('active');
      }
    });
  });

  const textarea = container.querySelector('#cypherTextarea');
  textarea.addEventListener('input', (e) => {
    qs.editorContent = e.target.value;
  });

  textarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runCurrentStudioQuery();
    }
  });

  document.getElementById('btnRunStudioQuery')?.addEventListener('click', runCurrentStudioQuery);
}

async function runCurrentStudioQuery() {
  const query = document.getElementById('cypherTextarea')?.value.trim();
  if (!query) return;

  const meta = document.getElementById('queryStudioMeta');
  if (meta) meta.innerText = 'Executing query on Neo4j AuraDB...';

  try {
    const res = await runCypher(query);
    state.queryStudio.results = res;
    if (meta) meta.innerText = `${res.rows.length} rows returned in ${res.duration}ms via ${res.via}`;
    const box = document.getElementById('studioResultsTableBox');
    if (box) box.innerHTML = renderQueryResultsTable(res);
  } catch (err) {
    if (meta) meta.innerText = `Error: ${err.message}`;
    const box = document.getElementById('studioResultsTableBox');
    if (box) {
      box.innerHTML = `<div style="padding: 2rem; color: var(--status-danger-text); font-family: var(--font-mono); font-size: 13px;">${err.message}</div>`;
    }
  }
}

function renderQueryResultsTable(res) {
  if (!res || !res.columns || res.columns.length === 0) {
    return `<div style="padding: 3rem; text-align: center; color: var(--text-tertiary); font-size: 13px;">Run a query above to see tabular results.</div>`;
  }

  let html = `<table class="data-table"><thead><tr>`;
  res.columns.forEach(col => html += `<th>${col}</th>`);
  html += `</tr></thead><tbody>`;
  res.rows.forEach(r => {
    html += `<tr>`;
    res.columns.forEach(col => {
      const val = r[col];
      html += `<td style="font-family: var(--font-mono); font-size: 12px;">${val !== null && val !== undefined ? (typeof val === 'object' ? JSON.stringify(val) : val) : ''}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  return html;
}

// ==========================================
// VIEW 9: SCHEMA EXPLORER
// ==========================================
function renderSchemaPage(container) {
  container.innerHTML = `
    <div class="page-header-row">
      <div>
        <h1 class="page-title">Database Schema</h1>
        <p class="page-desc">Structural specification of nodes, unique constraints, and physical pointer relationships.</p>
      </div>
    </div>

    <!-- Node Labels Table -->
    <div class="card-section">
      <div class="card-section-header">
        <span class="section-title">1. Node Labels & Primary Properties</span>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Primary Identifier</th>
              <th>Property Attributes</th>
              <th>DA2 Relational Source</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="code-tag">:Customer</span></td>
              <td style="font-family: var(--font-mono);">customer_id (Unique)</td>
              <td>name, email, dob, license_no, phones[]</td>
              <td><code>CUSTOMER</code> + <code>CUSTOMER_PHONE</code></td>
            </tr>
            <tr>
              <td><span class="code-tag">:Vehicle</span></td>
              <td style="font-family: var(--font-mono);">vehicle_id (Unique)</td>
              <td>reg_no, brand, vehicle_model, fuel_type, mfg_year, engine_no, chassis_no</td>
              <td><code>VEHICLE</code> Table</td>
            </tr>
            <tr>
              <td><span class="code-tag">:Policy</span></td>
              <td style="font-family: var(--font-mono);">policy_id (Unique)</td>
              <td>policy_type, premium_amount, sum_insured, start_date, end_date, policy_status</td>
              <td><code>POLICY</code> Table</td>
            </tr>
            <tr>
              <td><span class="code-tag">:Claim</span></td>
              <td style="font-family: var(--font-mono);">claim_id (Unique)</td>
              <td>claim_date, claim_amount, claim_status</td>
              <td><code>CLAIM</code> Table</td>
            </tr>
            <tr>
              <td><span class="code-tag">:Payment</span></td>
              <td style="font-family: var(--font-mono);">payment_id (Unique)</td>
              <td>payment_date, payment_method, amount</td>
              <td><code>PAYMENT</code> Table</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Relationships Table -->
    <div class="card-section">
      <div class="card-section-header">
        <span class="section-title">2. Directed Graph Relationships</span>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Source Node</th>
              <th>Relationship Type</th>
              <th>Target Node</th>
              <th>Cardinality</th>
              <th>Index-Free Adjacency Replacement</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>(:Customer)</code></td>
              <td><span class="rel-tag">[:OWNS]</span></td>
              <td><code>(:Vehicle)</code></td>
              <td>1 : M</td>
              <td>Replaces <code>VEHICLE.Customer_ID</code> Foreign Key</td>
            </tr>
            <tr>
              <td><code>(:Vehicle)</code></td>
              <td><span class="rel-tag">[:INSURED_BY]</span></td>
              <td><code>(:Policy)</code></td>
              <td>1 : 1</td>
              <td>Replaces <code>POLICY.Vehicle_ID</code> Foreign Key</td>
            </tr>
            <tr>
              <td><code>(:Policy)</code></td>
              <td><span class="rel-tag">[:GENERATES]</span></td>
              <td><code>(:Claim)</code></td>
              <td>1 : M</td>
              <td>Replaces <code>CLAIM.Policy_ID</code> Foreign Key</td>
            </tr>
            <tr>
              <td><code>(:Policy)</code></td>
              <td><span class="rel-tag">[:PAID_THROUGH]</span></td>
              <td><code>(:Payment)</code></td>
              <td>1 : M</td>
              <td>Replaces <code>PAYMENT.Policy_ID</code> Foreign Key</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function matchEntityId(prop, target) {
  if (prop === undefined || prop === null || target === undefined || target === null) return false;
  if (prop == target) return true;
  if (String(prop) === String(target)) return true;
  if (typeof prop === 'object' && prop.low !== undefined) {
    return String(prop.low) === String(target);
  }
  return false;
}

// ==========================================
// RECORD DETAIL DRAWER (SLIDE-OVER)
// ==========================================
function openRecordDetail(type, id) {
  const drawer = document.getElementById('detailDrawer');
  const overlay = document.getElementById('drawerOverlay');
  const badge = document.getElementById('drawerEntityBadge');
  const title = document.getElementById('drawerTitle');
  const body = document.getElementById('drawerBody');

  if (!drawer || !body) return;

  badge.innerText = type;

  if (type === 'Customer') {
    const c = state.data.customers.find(item => matchEntityId(item.customer_id, id));
    if (!c) {
      console.warn('Customer not found for id:', id);
      return;
    }
    title.innerText = c.name;
    const vehicles = state.data.vehicles.filter(v => matchEntityId(v.customer_id, id));

    body.innerHTML = `
      <div>
        <div class="detail-group-title">Personal Details</div>
        <div class="detail-grid">
          <span class="detail-label">Customer ID</span><span class="detail-value text-mono">#${c.customer_id}</span>
          <span class="detail-label">Email Address</span><span class="detail-value">${c.email}</span>
          <span class="detail-label">Date of Birth</span><span class="detail-value">${c.dob || 'N/A'}</span>
          <span class="detail-label">Driving License</span><span class="detail-value text-mono">${c.license_no}</span>
          <span class="detail-label">Address</span><span class="detail-value">${c.address || 'N/A'}</span>
          <span class="detail-label">Phone Numbers</span><span class="detail-value text-mono">${Array.isArray(c.phones) ? c.phones.join(', ') : (c.phones || 'N/A')}</span>
        </div>
      </div>

      <div>
        <div class="detail-group-title">Connected Vehicles Owned (${vehicles.length})</div>
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          ${vehicles.map(v => `
            <div style="background: var(--bg-surface-secondary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 0.75rem;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 600; font-family: var(--font-mono);">${v.reg_no}</span>
                <span class="badge badge-neutral">${v.fuel_type}</span>
              </div>
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 0.25rem;">
                ${v.brand} ${v.vehicle_model} (${v.mfg_year}) • Status: ${v.policy_status}
              </div>
            </div>
          `).join('') || '<div style="color: var(--text-tertiary); font-size: 13px;">No vehicles owned.</div>'}
        </div>
      </div>

      <div style="margin-top: auto; padding-top: 1.5rem; border-top: 1px solid var(--border-subtle);">
        <button class="btn btn-danger" id="btnDeleteCustomerAction" style="width: 100%;">
          Delete Customer Record
        </button>
      </div>
    `;

    document.getElementById('btnDeleteCustomerAction')?.addEventListener('click', async () => {
      if (confirm(`Are you sure you want to delete customer ${c.name}? Any connected links will be safely detached.`)) {
        await deleteCustomerRecord(c.customer_id);
      }
    });
  } else if (type === 'Vehicle') {
    const v = state.data.vehicles.find(item => matchEntityId(item.vehicle_id, id));
    if (!v) {
      console.warn('Vehicle not found for id:', id);
      return;
    }
    title.innerText = `${v.brand} ${v.vehicle_model} (${v.reg_no})`;

    body.innerHTML = `
      <div>
        <div class="detail-group-title">Vehicle Specifications</div>
        <div class="detail-grid">
          <span class="detail-label">Vehicle ID</span><span class="detail-value text-mono">#${v.vehicle_id}</span>
          <span class="detail-label">Registration</span><span class="detail-value text-mono">${v.reg_no}</span>
          <span class="detail-label">Manufacturer</span><span class="detail-value">${v.brand}</span>
          <span class="detail-label">Model</span><span class="detail-value">${v.vehicle_model}</span>
          <span class="detail-label">Fuel Type</span><span class="detail-value"><span class="badge badge-neutral">${v.fuel_type}</span></span>
          <span class="detail-label">Mfg Year</span><span class="detail-value text-mono">${v.mfg_year}</span>
          <span class="detail-label">Engine Number</span><span class="detail-value text-mono">${v.engine_no}</span>
          <span class="detail-label">Chassis Number</span><span class="detail-value text-mono">${v.chassis_no}</span>
        </div>
      </div>

      <div>
        <div class="detail-group-title">Registered Owner</div>
        <div style="background: var(--bg-surface-secondary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 0.75rem;">
          <div style="font-weight: 500;">${v.owner_name}</div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-top: 0.2rem;" class="text-mono">Customer ID: #${v.customer_id}</div>
        </div>
      </div>
    `;
  } else if (type === 'Claim') {
    const cl = state.data.claims.find(item => matchEntityId(item.claim_id, id));
    if (!cl) {
      console.warn('Claim not found for id:', id);
      return;
    }
    title.innerText = `Claim #${cl.claim_id}`;

    body.innerHTML = `
      <div>
        <div class="detail-group-title">Claim Overview</div>
        <div class="detail-grid">
          <span class="detail-label">Claim ID</span><span class="detail-value text-mono">#${cl.claim_id}</span>
          <span class="detail-label">Claim Amount</span><span class="detail-value text-mono">${formatCurrency(cl.claim_amount)}</span>
          <span class="detail-label">Date Filed</span><span class="detail-value text-mono">${cl.claim_date}</span>
          <span class="detail-label">Status</span><span class="detail-value">${renderStatusBadge(cl.claim_status)}</span>
          <span class="detail-label">Linked Policy</span><span class="detail-value text-mono">Policy #${cl.policy_id}</span>
          <span class="detail-label">Claimant</span><span class="detail-value">${cl.customer_name}</span>
        </div>
      </div>

      <div>
        <div class="detail-group-title">Change Claim Status</div>
        <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
          <button class="btn btn-secondary btn-update-status" data-status="APPROVED">Approve</button>
          <button class="btn btn-secondary btn-update-status" data-status="SETTLED">Settle</button>
          <button class="btn btn-secondary btn-update-status" data-status="REJECTED">Reject</button>
        </div>
      </div>

      <div style="margin-top: auto; padding-top: 1.5rem; border-top: 1px solid var(--border-subtle);">
        <button class="btn btn-danger" id="btnDeleteClaimAction" style="width: 100%;">
          Delete Claim Record
        </button>
      </div>
    `;

    body.querySelectorAll('.btn-update-status').forEach(btn => {
      btn.onclick = async () => {
        await updateClaimStatus(cl.claim_id, btn.dataset.status);
      };
    });

    document.getElementById('btnDeleteClaimAction')?.addEventListener('click', async () => {
      if (confirm(`Are you sure you want to permanently delete claim #${cl.claim_id}?`)) {
        await deleteClaimRecord(cl.claim_id);
      }
    });
  } else if (type === 'Policy') {
    const p = state.data.policies.find(item => matchEntityId(item.policy_id, id));
    if (!p) {
      console.warn('Policy not found for id:', id);
      return;
    }
    title.innerText = `Policy #${p.policy_id}`;

    body.innerHTML = `
      <div>
        <div class="detail-group-title">Coverage Terms</div>
        <div class="detail-grid">
          <span class="detail-label">Policy ID</span><span class="detail-value text-mono">#${p.policy_id}</span>
          <span class="detail-label">Coverage Type</span><span class="detail-value">${p.policy_type}</span>
          <span class="detail-label">Vehicle</span><span class="detail-value text-mono">${p.vehicle_reg}</span>
          <span class="detail-label">Annual Premium</span><span class="detail-value text-mono">${formatCurrency(p.premium_amount)}</span>
          <span class="detail-label">Sum Insured</span><span class="detail-value text-mono">${formatCurrency(p.sum_insured)}</span>
          <span class="detail-label">Status</span><span class="detail-value">${renderStatusBadge(p.policy_status)}</span>
          <span class="detail-label">Coverage Dates</span><span class="detail-value text-mono" style="font-size: 12px;">${p.start_date} to ${p.end_date}</span>
          <span class="detail-label">Total Paid</span><span class="detail-value text-mono">${formatCurrency(p.total_paid)}</span>
          <span class="detail-label">Outstanding</span><span class="detail-value">${renderBalanceCell(p.balance)}</span>
        </div>
      </div>
    `;
  } else if (type === 'Payment') {
    const pay = state.data.payments.find(item => matchEntityId(item.payment_id, id));
    if (!pay) {
      console.warn('Payment not found for id:', id);
      return;
    }
    title.innerText = `Payment #${pay.payment_id}`;

    body.innerHTML = `
      <div>
        <div class="detail-group-title">Transaction Receipt</div>
        <div class="detail-grid">
          <span class="detail-label">Payment ID</span><span class="detail-value text-mono">#${pay.payment_id}</span>
          <span class="detail-label">Policy ID</span><span class="detail-value text-mono">Policy #${pay.policy_id}</span>
          <span class="detail-label">Amount Paid</span><span class="detail-value text-mono" style="font-weight: 500;">${formatCurrency(pay.amount)}</span>
          <span class="detail-label">Payment Method</span><span class="detail-value"><span class="badge badge-neutral">${pay.payment_method}</span></span>
          <span class="detail-label">Payment Date</span><span class="detail-value text-mono">${pay.payment_date}</span>
          <span class="detail-label">Receipt File</span><span class="detail-value text-mono" style="font-size: 12px; color: var(--text-tertiary);">${pay.receipt_file || 'None'}</span>
        </div>
      </div>
    `;
  }

  drawer.classList.add('open');
  overlay.style.display = 'block';
}

function closeRecordDetail() {
  document.getElementById('detailDrawer')?.classList.remove('open');
  const overlay = document.getElementById('drawerOverlay');
  if (overlay) overlay.style.display = 'none';
}

// ==========================================
// CRUD OPERATIONS (LIVE ON NEO4J)
// ==========================================
async function updateClaimStatus(claimId, newStatus) {
  showToast(`Updating claim #${claimId} to ${newStatus}...`);
  try {
    await runCypher(`
      MATCH (cl:Claim {claim_id: $id})
      SET cl.claim_status = $status
      RETURN cl;
    `, { id: claimId, status: newStatus });
    showToast(`Claim #${claimId} updated successfully.`);
    closeRecordDetail();
    await reloadAllData();
  } catch (err) {
    alert(`Failed to update claim: ${err.message}`);
  }
}

async function deleteClaimRecord(claimId) {
  showToast(`Deleting claim #${claimId}...`);
  try {
    await runCypher(`
      MATCH (cl:Claim {claim_id: $id})
      OPTIONAL MATCH (cl)-[:HAS_DOCUMENT]->(doc:ClaimDocument)
      DETACH DELETE cl, doc;
    `, { id: claimId });
    showToast(`Claim #${claimId} deleted.`);
    closeRecordDetail();
    await reloadAllData();
  } catch (err) {
    alert(`Failed to delete claim: ${err.message}`);
  }
}

async function deleteCustomerRecord(customerId) {
  showToast(`Deleting customer #${customerId}...`);
  try {
    await runCypher(`
      MATCH (c:Customer {customer_id: $id})
      DETACH DELETE c;
    `, { id: customerId });
    showToast(`Customer #${customerId} deleted.`);
    closeRecordDetail();
    await reloadAllData();
  } catch (err) {
    alert(`Failed to delete customer: ${err.message}`);
  }
}

// ==========================================
// EVENT LISTENERS & SHORTCUTS
// ==========================================
function setupShellEventListeners() {
  // Navigation
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(el.dataset.route);
    });
  });

  // Mobile Menu
  document.getElementById('btnToggleMobileMenu')?.addEventListener('click', () => {
    state.sidebarOpen = !state.sidebarOpen;
    document.getElementById('sidebar')?.classList.toggle('open', state.sidebarOpen);
  });

  // Drawer
  document.getElementById('btnCloseDrawer')?.addEventListener('click', closeRecordDetail);
  document.getElementById('drawerOverlay')?.addEventListener('click', closeRecordDetail);

  // Global Refresh
  document.getElementById('btnGlobalRefresh')?.addEventListener('click', async () => {
    showToast('Refreshing database...');
    await reloadAllData();
    showToast('All records updated from Neo4j.');
  });



  // Add Customer Modal
  document.getElementById('btnCloseAddCustomer')?.addEventListener('click', () => closeModal('addCustomerModal'));
  document.getElementById('btnCancelAddCustomer')?.addEventListener('click', () => closeModal('addCustomerModal'));
  document.getElementById('formCreateCustomer')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('modalCustName').value.trim();
    const email = document.getElementById('modalCustEmail').value.trim();
    const license = document.getElementById('modalCustLicense').value.trim();
    const address = document.getElementById('modalCustAddress').value.trim() || 'Address on record';
    const phone = document.getElementById('modalCustPhone').value.trim() || '9876500000';

    try {
      showToast('Creating customer node in Neo4j...');
      const idRes = await runCypher('MATCH (c:Customer) RETURN coalesce(max(c.customer_id), 0) + 1 AS nextId');
      const nextId = idRes.rows[0].nextId;

      await runCypher(`
        CREATE (c:Customer {
          customer_id: $id,
          name: $name,
          email: $email,
          license_no: $license,
          address: $address,
          phones: [$phone],
          dob: date('2000-01-01')
        })
        RETURN c;
      `, { id: nextId, name, email, license, address, phone });

      closeModal('addCustomerModal');
      showToast(`Customer #${nextId} created successfully.`);
      await reloadAllData();
    } catch (err) {
      alert(`Error creating customer: ${err.message}`);
    }
  });

  // Global Search Modal (⌘K)
  document.getElementById('btnOpenSearch')?.addEventListener('click', () => {
    openModal('searchModal');
    setTimeout(() => document.getElementById('cmdInput')?.focus(), 50);
  });

  // Close search modal when clicking backdrop
  document.getElementById('searchModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'searchModal') closeModal('searchModal');
  });

  const cmdInput = document.getElementById('cmdInput');
  cmdInput?.addEventListener('input', (e) => {
    handleGlobalSearch(e.target.value.trim());
  });

  cmdInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = document.querySelector('.cmd-item');
      if (first) {
        e.preventDefault();
        selectSearchResult(first.dataset.type, first.dataset.id);
      }
    }
  });

  // Delegated click listener on cmdResults
  document.getElementById('cmdResults')?.addEventListener('click', (e) => {
    const item = e.target.closest('.cmd-item');
    if (!item) return;
    selectSearchResult(item.dataset.type, item.dataset.id);
  });
}

function selectSearchResult(type, id) {
  closeModal('searchModal');
  const cmdInput = document.getElementById('cmdInput');
  if (cmdInput) cmdInput.value = '';

  const navTarget = type === 'Customer' ? 'customers'
    : type === 'Vehicle' ? 'vehicles'
    : type === 'Policy' ? 'policies'
    : type === 'Claim' ? 'claims'
    : null;

  if (navTarget) {
    navigate(navTarget);
  }

  setTimeout(() => {
    openRecordDetail(type, id);
  }, 60);
}

function handleGlobalSearch(term) {
  const box = document.getElementById('cmdResults');
  if (!box) return;

  if (!term || term.length < 2) {
    box.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: var(--text-tertiary); font-size: 13px;">Type at least 2 characters to search across all insurance entities...</div>`;
    return;
  }

  const q = term.toLowerCase();
  const cMatches = state.data.customers.filter(c => c.name.toLowerCase().includes(q) || c.license_no.toLowerCase().includes(q)).slice(0, 3);
  const vMatches = state.data.vehicles.filter(v => v.reg_no.toLowerCase().includes(q) || v.brand.toLowerCase().includes(q)).slice(0, 3);
  const pMatches = state.data.policies.filter(p => String(p.policy_id).includes(q) || p.policy_type.toLowerCase().includes(q)).slice(0, 3);
  const clMatches = state.data.claims.filter(c => String(c.claim_id).includes(q) || c.claim_status.toLowerCase().includes(q)).slice(0, 3);

  const total = cMatches.length + vMatches.length + pMatches.length + clMatches.length;
  if (total === 0) {
    box.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: var(--text-tertiary); font-size: 13px;">No results found for "${term}".</div>`;
    return;
  }

  let html = '';
  if (cMatches.length > 0) {
    html += `<div class="cmd-group-title">Customers</div>`;
    cMatches.forEach(c => {
      html += `
        <div class="cmd-item" data-type="Customer" data-id="${c.customer_id}">
          <span style="pointer-events: none; display: flex; align-items: center; gap: 8px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            ${c.name}
          </span>
          <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-tertiary); pointer-events: none;">${c.license_no}</span>
        </div>
      `;
    });
  }

  if (vMatches.length > 0) {
    html += `<div class="cmd-group-title">Vehicles</div>`;
    vMatches.forEach(v => {
      html += `
        <div class="cmd-item" data-type="Vehicle" data-id="${v.vehicle_id}">
          <span style="pointer-events: none; display: flex; align-items: center; gap: 8px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C1.4 11.2 1 12 1 13v3c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>
            ${v.brand} ${v.vehicle_model}
          </span>
          <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-tertiary); pointer-events: none;">${v.reg_no}</span>
        </div>
      `;
    });
  }

  if (pMatches.length > 0) {
    html += `<div class="cmd-group-title">Policies</div>`;
    pMatches.forEach(p => {
      html += `
        <div class="cmd-item" data-type="Policy" data-id="${p.policy_id}">
          <span style="pointer-events: none; display: flex; align-items: center; gap: 8px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            Policy #${p.policy_id} (${p.policy_type})
          </span>
          <span style="pointer-events: none;">${renderStatusBadge(p.policy_status)}</span>
        </div>
      `;
    });
  }

  if (clMatches.length > 0) {
    html += `<div class="cmd-group-title">Claims</div>`;
    clMatches.forEach(cl => {
      html += `
        <div class="cmd-item" data-type="Claim" data-id="${cl.claim_id}">
          <span style="pointer-events: none; display: flex; align-items: center; gap: 8px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            Claim #${cl.claim_id} (${formatCurrency(cl.claim_amount)})
          </span>
          <span style="pointer-events: none;">${renderStatusBadge(cl.claim_status)}</span>
        </div>
      `;
    });
  }

  box.innerHTML = html;

  box.querySelectorAll('.cmd-item').forEach(item => {
    item.onclick = (e) => {
      e.stopPropagation();
      selectSearchResult(item.dataset.type, item.dataset.id);
    };
  });
}

function setupGlobalShortcuts() {
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      openModal('searchModal');
      setTimeout(() => document.getElementById('cmdInput')?.focus(), 50);
    } else if (e.key === 'Escape') {
      closeModal('searchModal');
      closeModal('settingsModal');
      closeModal('addCustomerModal');
      closeRecordDetail();
    }
  });
}

// Modal Helpers
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.style.display = 'flex';
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.style.display = 'none';
}

function showToast(msg) {
  const toast = document.getElementById('toastBar');
  if (!toast) return;
  toast.innerText = msg;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 2800);
}

// Start
initApp();
