# Vehicle Insurance Management System (BACSE202 DA3)
### Modern Graph Database Implementation with Neo4j & Cypher

**Student Name:** Vinayak Tripathi  
**Registration Number:** 25BRS1259  
**Course Code:** BACSE202 – Database Systems  
**Faculty:** Dr. Rajesh M  
**Submission Deadline:** 23-10-2026  

---

## 📌 Project Overview
This project is Digital Assignment 3 (DA3) for **Database Systems (BACSE202)**. It re-implements the **Vehicle Insurance Management System** developed in DA1 (Database Design & ER Modeling) and DA2 (Oracle SQL & PL/SQL) using **Neo4j**, a modern Labeled Property Graph (LPG) database, powered by the **Cypher Query Language**.

The project models the complete domain—customers, vehicles, insurance policies, claims, payment transactions, and supporting documents/receipts—replacing relational foreign keys and costly multi-table joins with native, pointer-based graph relationships (**Index-Free Adjacency**).

---

## 🚀 Key Features

* **Live Neo4j AuraDB Integration:** Full integration via the official `neo4j-driver` over Bolt protocol (`neo4j+s://`).
* **Interactive Physics Graph Visualizer:** Real-time force-directed canvas displaying nodes (`Customer`, `Vehicle`, `Policy`, `Claim`, `Payment`) and relationships (`OWNS`, `INSURED_BY`, `GENERATES`, `PAID_THROUGH`) with zoom, pan, drag-and-drop, and property inspection.
* **Cypher Query Studio:** Live Cypher query execution runner featuring side-by-side comparison with equivalent Oracle SQL queries from DA2.
* **CRUD Management Studio:** Interactive interface to create nodes, update claim statuses, and perform cascade deletes (`DETACH DELETE`) directly against the live database.
* **Oracle SQL vs. Neo4j Cypher Comparison:** In-depth technical breakdown of joins vs. pointer traversals, 1NF normalization vs. array properties, and execution costs.

---

## 🗄️ Graph Database Schema & Mapping

```
(:Customer) ──[:OWNS]──> (:Vehicle) ──[:INSURED_BY]──> (:Policy)
                             │                             │
                      [:HAS_IMAGE]                ┌────────┴────────┐
                             │                    │                 │
                      (:VehicleImage)     [:GENERATES]      [:PAID_THROUGH]
                                                  │                 │
                                                  ▼                 ▼
                                              (:Claim)          (:Payment)
                                                  │                 │
                                           [:HAS_DOCUMENT]    [:HAS_RECEIPT]
                                                  │                 │
                                                  ▼                 ▼
                                           (:ClaimDocument)  (:PaymentReceipt)
```

### Relational (DA2) to Graph (DA3) Transformation:
| Oracle Relational (DA2) | Neo4j Graph Model (DA3) | Description |
| :--- | :--- | :--- |
| `CUSTOMER` Table | `(:Customer)` Node | Primary key `Customer_ID` mapped to unique property `customer_id`. |
| `CUSTOMER_PHONE` Table | `phones: [...]` Array Property | Multivalued attribute stored directly without breaking 1NF. |
| `VEHICLE` Table | `(:Vehicle)` Node | Stores vehicle specs, engine/chassis numbers, and fuel type. |
| `POLICY` Table | `(:Policy)` Node | Covers comprehensive, third party, and own damage policies. |
| `CLAIM` Table | `(:Claim)` Node | Tracks claim status (`PENDING`, `APPROVED`, `SETTLED`, `REJECTED`). |
| `PAYMENT` Table | `(:Payment)` Node | Tracks premium payments and transaction methods. |
| Foreign Key `Customer_ID` | `[:OWNS]` Edge | Directed relationship `(:Customer)-[:OWNS]->(:Vehicle)`. |
| Foreign Key `Vehicle_ID` | `[:INSURED_BY]` Edge | Directed relationship `(:Vehicle)-[:INSURED_BY]->(:Policy)`. |
| Foreign Key `Policy_ID` | `[:GENERATES]` Edge | Directed relationship `(:Policy)-[:GENERATES]->(:Claim)`. |
| Foreign Key `Policy_ID` | `[:PAID_THROUGH]` Edge | Directed relationship `(:Policy)-[:PAID_THROUGH]->(:Payment)`. |
| Weak Entities | Dependent Nodes | Connected via `[:HAS_IMAGE]`, `[:HAS_DOCUMENT]`, `[:HAS_RECEIPT]`. |

---

## 🛠️ Getting Started

### 1. Prerequisites
* [Node.js](https://nodejs.org/) (v18 or higher)
* [Neo4j AuraDB Free Instance](https://console.neo4j.io) (or local Neo4j Desktop)

### 2. Environment Setup
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Edit `.env` and fill in your Neo4j AuraDB connection details:
```ini
VITE_NEO4J_URI=neo4j+s://<your-instance-id>.databases.neo4j.io
VITE_NEO4J_USER=neo4j
VITE_NEO4J_PASSWORD=<your-database-password>
VITE_NEO4J_DATABASE=neo4j

VITE_STUDENT_NAME=Vinayak Tripathi
VITE_STUDENT_REGNO=25BRS1259
VITE_COURSE_CODE=BACSE202
VITE_FACULTY_NAME=Dr. Rajesh M
```

### 3. Install & Run
```bash
# Install dependencies
npm install

# Start local development server
npm run dev
```

Visit **`http://localhost:5173/`** to interact with the application.

---

## 📜 Executing Cypher Scripts on Neo4j AuraDB

You can execute the setup Cypher scripts either directly via the web interface or in the **Neo4j Workspace Query Editor**:

### Step 1: Create Constraints
```cypher
CREATE CONSTRAINT unique_customer_id IF NOT EXISTS FOR (c:Customer) REQUIRE c.customer_id IS UNIQUE;
CREATE CONSTRAINT unique_vehicle_id IF NOT EXISTS FOR (v:Vehicle) REQUIRE v.vehicle_id IS UNIQUE;
CREATE CONSTRAINT unique_policy_id IF NOT EXISTS FOR (p:Policy) REQUIRE p.policy_id IS UNIQUE;
CREATE CONSTRAINT unique_claim_id IF NOT EXISTS FOR (cl:Claim) REQUIRE cl.claim_id IS UNIQUE;
CREATE CONSTRAINT unique_payment_id IF NOT EXISTS FOR (pay:Payment) REQUIRE pay.payment_id IS UNIQUE;
CREATE CONSTRAINT unique_vehicle_reg IF NOT EXISTS FOR (v:Vehicle) REQUIRE v.reg_no IS UNIQUE;
CREATE CONSTRAINT unique_customer_email IF NOT EXISTS FOR (c:Customer) REQUIRE c.email IS UNIQUE;
CREATE CONSTRAINT unique_customer_license IF NOT EXISTS FOR (c:Customer) REQUIRE c.license_no IS UNIQUE;
```

### Step 2: Sample 4-Hop Traversal Query
```cypher
MATCH (c:Customer)-[:OWNS]->(v:Vehicle)-[:INSURED_BY]->(p:Policy)-[:GENERATES]->(cl:Claim)
RETURN cl.claim_id AS Claim_ID, c.name AS Customer, v.reg_no AS Reg_No, 
       cl.claim_amount AS Amount, cl.claim_status AS Status
ORDER BY cl.claim_id;
```

---

## 📊 Project Structure

```
├── .env                  # Neo4j credentials & student metadata (git-ignored)
├── .env.example          # Environment template
├── index.html            # Main web entrypoint
├── package.json          # Node dependencies (vite, neo4j-driver)
├── README.md             # Project documentation
└── src/
    ├── data.js           # DA2 baseline dataset & preloaded Cypher queries
    ├── neo4j.js          # Official neo4j-driver Bolt connection & queries
    ├── style.css         # Modern dark-mode vanilla CSS design system
    └── main.js           # Interactive graph engine, Cypher playground & CRUD
```

---

## 📄 Academic Submission Notes (BACSE202)
* The complete 11-section handwritten report draft with labeled screenshot figures (Figures 1 through 10) is located at `da3_final_report_draft.md`.
* Refer to `da3_implementation_plan.md` for the step-by-step evaluation guide and viva checklist.

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).
