const express = require('express');
const initSqlJs = require('sql.js');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'defectpro-secret-key-2026';

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'defectpro.db');

// 角色级别定义（数字越小级别越高）
const ROLE_LEVELS = {
  '系统管理员': 1,
  'PM': 2,
  '项目经理': 2,
  '开发工程师': 2,
  '测试工程师': 2,
  '观察者': 3
};

function getRoleLevel(roleName) {
  return ROLE_LEVELS[roleName] || 999; // 未定义的角色视为最低级别
}

let db; // sql.js Database instance

// Helper: save db to file
function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Helper: run query returning rows as objects
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length > 0 ? rows[0] : null;
}
function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

async function initDb() {
  const SQL = await initSqlJs();

  // Load existing db or create new
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  db.run(`CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', permissions TEXT DEFAULT '[]')`);
  db.run(`CREATE TABLE IF NOT EXISTS personnel (empId TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT DEFAULT '', department TEXT DEFAULT '', roleId TEXT DEFAULT '', active INTEGER DEFAULT 1)`);
  db.run(`CREATE TABLE IF NOT EXISTS versions (version TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT DEFAULT '规划中', plannedDate TEXT DEFAULT '', releaseDate TEXT DEFAULT '', notes TEXT DEFAULT '')`);
  db.run(`CREATE TABLE IF NOT EXISTS requirements (id TEXT PRIMARY KEY, title TEXT NOT NULL, priority TEXT DEFAULT '中', status TEXT DEFAULT '待评审', version TEXT DEFAULT '', owner TEXT DEFAULT '', description TEXT DEFAULT '', logs TEXT DEFAULT '[]', createdAt TEXT DEFAULT '')`);
  db.run(`CREATE TABLE IF NOT EXISTS defects (id TEXT PRIMARY KEY, title TEXT NOT NULL, severity TEXT DEFAULT '一般', status TEXT DEFAULT '新建', version TEXT DEFAULT '', relatedReq TEXT DEFAULT '', assignee TEXT DEFAULT '', reporter TEXT DEFAULT '', description TEXT DEFAULT '', createdAt TEXT DEFAULT '', logs TEXT DEFAULT '[]')`);
  db.run(`CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT '缺陷', description TEXT DEFAULT '', steps TEXT DEFAULT '[]', transitions TEXT DEFAULT '[]')`);
  db.run(`CREATE TABLE IF NOT EXISTS accounts (username TEXT PRIMARY KEY, password TEXT NOT NULL, empId TEXT DEFAULT '', roleName TEXT DEFAULT '', enabled INTEGER DEFAULT 1, createdAt TEXT DEFAULT '', lastLogin TEXT DEFAULT '')`);

  seedData();
  saveDb();
}

function seedData() {
  const rc = get('SELECT COUNT(*) as c FROM roles').c;
  if (rc === 0) {
    const iP = (id, name, desc, perms) => run('INSERT INTO roles (id,name,description,permissions) VALUES (?,?,?,?)', [id, name, desc, JSON.stringify(perms)]);
    const all = ['创建缺陷','编辑缺陷','删除缺陷','分配缺陷','关闭缺陷','创建需求','编辑需求','删除需求','管理人员','管理角色','管理版本','管理流程','管理账号','查看报表'];
    iP('admin','系统管理员','拥有所有权限', all);
    iP('pm','项目经理','管理需求和版本', ['创建需求','编辑需求','删除需求','管理版本','管理流程','查看报表','分配缺陷']);
    iP('dev','开发工程师','修复缺陷', ['创建缺陷','编辑缺陷','查看报表']);
    iP('qa','测试工程师','提交和验证缺陷', ['创建缺陷','编辑缺陷','关闭缺陷','创建需求','查看报表']);
    iP('viewer','观察者','只读查看', ['查看报表']);
  }
  const pc = get('SELECT COUNT(*) as c FROM personnel').c;
  if (pc === 0) {
    const i = (e,n,em,d,r,a) => run('INSERT INTO personnel (empId,name,email,department,roleId,active) VALUES (?,?,?,?,?,?)', [e,n,em,d,r,a]);
    i('EMP001','张三','zhangsan@example.com','研发部','dev',1);
    i('EMP002','李四','lisi@example.com','测试部','qa',1);
    i('EMP003','王五','wangwu@example.com','产品部','pm',1);
    i('EMP004','赵六','zhaoliu@example.com','研发部','dev',1);
    i('EMP005','孙七','sunqi@example.com','运维部','admin',1);
  }
  const vc = get('SELECT COUNT(*) as c FROM versions').c;
  if (vc === 0) {
    const i = (v,n,s,p,r,no) => run('INSERT INTO versions (version,name,status,plannedDate,releaseDate,notes) VALUES (?,?,?,?,?,?)', [v,n,s,p,r,no]);
    i('v1.0.0','首次发布','已发布','2026-06-01','2026-06-05','首个正式版本');
    i('v1.1.0','体验优化','测试中','2026-08-01','','UI优化与性能提升');
    i('v2.0.0','重大升级','开发中','2026-10-01','','全新架构升级');
  }
  const wc = get('SELECT COUNT(*) as c FROM workflows').c;
  if (wc === 0) {
    run('INSERT INTO workflows (id,name,type,description,steps,transitions) VALUES (?,?,?,?,?,?)', ['wf_defect','缺陷处理流程','缺陷','标准缺陷生命周期管理',
      JSON.stringify(['新建','已确认','修复中','已修复','验证中','已关闭','已拒绝','重新打开']),
      JSON.stringify([{from:'新建',to:'已确认'},{from:'新建',to:'已拒绝'},{from:'已确认',to:'修复中'},{from:'修复中',to:'已修复'},{from:'已修复',to:'验证中'},{from:'验证中',to:'已关闭'},{from:'验证中',to:'重新打开'},{from:'重新打开',to:'修复中'},{from:'已拒绝',to:'重新打开'}])]);
    run('INSERT INTO workflows (id,name,type,description,steps,transitions) VALUES (?,?,?,?,?,?)', ['wf_req','需求管理流程','需求','需求从提出到上线的完整流程',
      JSON.stringify(['待评审','已通过','开发中','测试中','已上线','已拒绝','已搁置']),
      JSON.stringify([{from:'待评审',to:'已通过'},{from:'待评审',to:'已拒绝'},{from:'待评审',to:'已搁置'},{from:'已通过',to:'开发中'},{from:'开发中',to:'测试中'},{from:'测试中',to:'已上线'},{from:'测试中',to:'开发中'},{from:'已搁置',to:'待评审'}])]);
  }
  const ac = get('SELECT COUNT(*) as c FROM accounts').c;
  if (ac === 0) {
    const hash = bcrypt.hashSync('Dp#9kLm@2qX!7', 10);
    run('INSERT INTO accounts (username,password,empId,roleName,enabled,createdAt,lastLogin) VALUES (?,?,?,?,?,?,?)', ['admin',hash,'','系统管理员',1,'2026-01-01','']);
  }
  const rqc = get('SELECT COUNT(*) as c FROM requirements').c;
  if (rqc === 0) {
    const i = (id,t,p,s,v,o,d,l,c) => run('INSERT INTO requirements (id,title,priority,status,version,owner,description,logs,createdAt) VALUES (?,?,?,?,?,?,?,?,?)', [id,t,p,s,v,o,d,JSON.stringify(l),c]);
    i('REQ-001','用户登录功能','高','已上线','v1.0.0','EMP001','支持手机号和邮箱登录',[{action:'创建需求',time:'2026-05-01 10:00'},{action:'状态：待评审 → 已通过',time:'2026-05-03 14:00'},{action:'状态：已通过 → 开发中',time:'2026-05-05 09:00'},{action:'状态：开发中 → 测试中',time:'2026-05-20 16:00'},{action:'状态：测试中 → 已上线',time:'2026-06-01 10:00'}],'2026-05-01');
    i('REQ-002','数据导出功能','中','开发中','v1.1.0','EMP004','支持CSV和Excel格式导出',[{action:'创建需求',time:'2026-06-15 11:00'},{action:'状态：待评审 → 已通过',time:'2026-06-18 09:00'},{action:'状态：已通过 → 开发中，负责人：张三 → 赵六',time:'2026-06-20 10:00'}],'2026-06-15');
    i('REQ-003','消息推送系统','紧急','待评审','v2.0.0','EMP003','实时消息推送，支持WebSocket',[{action:'创建需求',time:'2026-07-20 15:00'}],'2026-07-20');
  }
  const dc = get('SELECT COUNT(*) as c FROM defects').c;
  if (dc === 0) {
    const i = (id,t,sv,st,v,rq,a,rp,d,c,l) => run('INSERT INTO defects (id,title,severity,status,version,relatedReq,assignee,reporter,description,createdAt,logs) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id,t,sv,st,v,rq,a,rp,d,c,JSON.stringify(l)]);
    i('BUG-001','登录页面输入框溢出','一般','已修复','v1.0.0','REQ-001','EMP001','EMP002','在移动端浏览器中，用户名输入框超出屏幕边界','2026-06-10',[{action:'创建缺陷',time:'2026-06-10 09:30'},{action:'状态：新建 → 已确认',time:'2026-06-10 14:00'},{action:'状态：已确认 → 修复中',time:'2026-06-11 09:00'},{action:'状态：修复中 → 已修复',time:'2026-06-12 16:00'}]);
    i('BUG-002','数据导出超时崩溃','严重','修复中','v1.1.0','REQ-002','EMP004','EMP002','导出数据超过10万条时系统超时并崩溃','2026-07-15',[{action:'创建缺陷',time:'2026-07-15 10:00'},{action:'状态：新建 → 已确认，严重程度：一般 → 严重',time:'2026-07-15 15:00'},{action:'状态：已确认 → 修复中，指派：张三 → 赵六',time:'2026-07-16 09:00'}]);
    i('BUG-003','权限校验绕过漏洞','致命','已确认','v1.1.0','','EMP001','EMP005','通过直接访问API接口可绕过权限校验','2026-07-25',[{action:'创建缺陷',time:'2026-07-25 08:00'},{action:'状态：新建 → 已确认，严重程度：严重 → 致命',time:'2026-07-25 10:00'}]);
  }
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '未登录' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: '登录已过期' }); }
}

function parseJsonField(val) { if (!val) return []; try { return JSON.parse(val); } catch { return []; } }

// 密码强度校验：返回错误信息字符串，或 null 表示通过
const COMMON_PW = ['password','123456','12345678','qwerty','abc123','admin','admin123','password123','administrator','letmein','welcome','iloveyou','password1','Password1','Password123','Admin@123','Admin123','qwerty123','000000','111111','passw0rd','p@ssw0rd'];
function validatePassword(pw) {
  if (!pw || pw.length < 8) return '密码至少8位，且需包含大小写字母、数字和特殊字符';
  if (!/[a-z]/.test(pw)) return '密码需包含小写字母';
  if (!/[A-Z]/.test(pw)) return '密码需包含大写字母';
  if (!/[0-9]/.test(pw)) return '密码需包含数字';
  if (!/[^A-Za-z0-9]/.test(pw)) return '密码需包含特殊字符（如 !@#$%^&*）';
  if (COMMON_PW.includes(pw.toLowerCase())) return '该密码过于常见，已被大量泄露，请更换';
  return null;
}

// ==================== Auth ====================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const account = get('SELECT * FROM accounts WHERE username = ?', [username]);
  if (!account) return res.status(401).json({ error: '账号不存在' });
  if (!account.enabled) return res.status(401).json({ error: '该账号已被禁用，请联系管理员' });
  if (!bcrypt.compareSync(password, account.password)) return res.status(401).json({ error: '密码错误' });
  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
  run('UPDATE accounts SET lastLogin = ? WHERE username = ?', [nowStr, username]);
  let displayName = username;
  if (account.empId) { const p = get('SELECT name FROM personnel WHERE empId = ?', [account.empId]); if (p) displayName = p.name; }
  const token = jwt.sign({ username: account.username, empId: account.empId, roleName: account.roleName, displayName }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { username: account.username, displayName, roleName: account.roleName || '未分配角色' } });
});

app.post('/api/register', (req, res) => {
  const { username, password, empId } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请填写用户名和密码' });
  const pe = validatePassword(password); if (pe) return res.status(400).json({ error: pe });
  if (get('SELECT username FROM accounts WHERE username = ?', [username])) return res.status(400).json({ error: '用户名已存在' });
  const hash = bcrypt.hashSync(password, 10);
  let roleName = '';
  if (empId) { const p = get('SELECT roleId FROM personnel WHERE empId = ?', [empId]); if (p) { const r = get('SELECT name FROM roles WHERE id = ?', [p.roleId]); if (r) roleName = r.name; } }
  run('INSERT INTO accounts (username,password,empId,roleName,enabled,createdAt,lastLogin) VALUES (?,?,?,?,1,?,?)', [username, hash, empId || '', roleName, new Date().toISOString().split('T')[0], '']);
  res.json({ message: '注册成功' });
});

// ==================== Roles ====================
app.get('/api/roles', authMiddleware, (req, res) => { res.json(all('SELECT * FROM roles').map(r => ({ ...r, permissions: parseJsonField(r.permissions) }))); });
app.post('/api/roles', authMiddleware, (req, res) => {
  const { id, name, description, permissions } = req.body;
  if (!id || !name) return res.status(400).json({ error: '请填写角色ID和名称' });
  if (get('SELECT id FROM roles WHERE id = ?', [id])) return res.status(400).json({ error: '角色ID已存在' });
  run('INSERT INTO roles (id,name,description,permissions) VALUES (?,?,?,?)', [id, name, description || '', JSON.stringify(permissions || [])]);
  res.json({ message: '创建成功' });
});
app.put('/api/roles/:id', authMiddleware, (req, res) => { const { name, description, permissions } = req.body; run('UPDATE roles SET name=?,description=?,permissions=? WHERE id=?', [name, description || '', JSON.stringify(permissions || []), req.params.id]); res.json({ message: '更新成功' }); });
app.delete('/api/roles/:id', authMiddleware, (req, res) => { if (get('SELECT COUNT(*) as c FROM personnel WHERE roleId=?', [req.params.id]).c > 0) return res.status(400).json({ error: '该角色下还有关联人员，无法删除' }); run('DELETE FROM roles WHERE id=?', [req.params.id]); res.json({ message: '删除成功' }); });

// ==================== Personnel ====================
app.get('/api/personnel', authMiddleware, (req, res) => { res.json(all('SELECT * FROM personnel').map(p => ({ ...p, active: !!p.active }))); });
app.post('/api/personnel', authMiddleware, (req, res) => {
  const { empId, name, email, department, roleId, active } = req.body;
  if (!empId || !name) return res.status(400).json({ error: '请填写工号和姓名' });
  if (get('SELECT empId FROM personnel WHERE empId=?', [empId])) return res.status(400).json({ error: '工号已存在' });
  run('INSERT INTO personnel (empId,name,email,department,roleId,active) VALUES (?,?,?,?,?,?)', [empId, name, email || '', department || '', roleId || '', active ? 1 : 0]);
  res.json({ message: '创建成功' });
});
app.put('/api/personnel/:empId', authMiddleware, (req, res) => { const { name, email, department, roleId, active } = req.body; run('UPDATE personnel SET name=?,email=?,department=?,roleId=?,active=? WHERE empId=?', [name, email || '', department || '', roleId || '', active ? 1 : 0, req.params.empId]); res.json({ message: '更新成功' }); });
app.delete('/api/personnel/:empId', authMiddleware, (req, res) => { run('DELETE FROM personnel WHERE empId=?', [req.params.empId]); res.json({ message: '删除成功' }); });

// ==================== Versions ====================
app.get('/api/versions', authMiddleware, (req, res) => { res.json(all('SELECT * FROM versions')); });
app.post('/api/versions', authMiddleware, (req, res) => {
  const { version, name, status, plannedDate, releaseDate, notes } = req.body;
  if (!version || !name) return res.status(400).json({ error: '请填写版本号和名称' });
  if (get('SELECT version FROM versions WHERE version=?', [version])) return res.status(400).json({ error: '版本号已存在' });
  run('INSERT INTO versions (version,name,status,plannedDate,releaseDate,notes) VALUES (?,?,?,?,?,?)', [version, name, status || '规划中', plannedDate || '', releaseDate || '', notes || '']);
  res.json({ message: '创建成功' });
});
app.put('/api/versions/:version', authMiddleware, (req, res) => { const { name, status, plannedDate, releaseDate, notes } = req.body; run('UPDATE versions SET name=?,status=?,plannedDate=?,releaseDate=?,notes=? WHERE version=?', [name, status, plannedDate || '', releaseDate || '', notes || '', req.params.version]); res.json({ message: '更新成功' }); });
app.delete('/api/versions/:version', authMiddleware, (req, res) => { run('DELETE FROM versions WHERE version=?', [req.params.version]); res.json({ message: '删除成功' }); });

// ==================== Requirements ====================
app.get('/api/requirements', authMiddleware, (req, res) => { res.json(all('SELECT * FROM requirements').map(r => ({ ...r, logs: parseJsonField(r.logs) }))); });
app.post('/api/requirements', authMiddleware, (req, res) => {
  const { id, title, priority, status, version, owner, description, logs } = req.body;
  if (!id || !title) return res.status(400).json({ error: '请填写需求ID和标题' });
  if (get('SELECT id FROM requirements WHERE id=?', [id])) return res.status(400).json({ error: '需求ID已存在' });
  run('INSERT INTO requirements (id,title,priority,status,version,owner,description,logs,createdAt) VALUES (?,?,?,?,?,?,?,?,?)', [id, title, priority || '中', status || '待评审', version || '', owner || '', description || '', JSON.stringify(logs || []), new Date().toISOString().split('T')[0]]);
  res.json({ message: '创建成功' });
});
app.put('/api/requirements/:id', authMiddleware, (req, res) => { const { title, priority, status, version, owner, description, logs } = req.body; run('UPDATE requirements SET title=?,priority=?,status=?,version=?,owner=?,description=?,logs=? WHERE id=?', [title, priority, status, version || '', owner || '', description || '', JSON.stringify(logs || []), req.params.id]); res.json({ message: '更新成功' }); });
app.delete('/api/requirements/:id', authMiddleware, (req, res) => { run('DELETE FROM requirements WHERE id=?', [req.params.id]); res.json({ message: '删除成功' }); });

// ==================== Defects ====================
app.get('/api/defects', authMiddleware, (req, res) => { res.json(all('SELECT * FROM defects').map(d => ({ ...d, logs: parseJsonField(d.logs) }))); });
app.post('/api/defects', authMiddleware, (req, res) => {
  const { id, title, severity, status, version, relatedReq, assignee, reporter, description, logs } = req.body;
  if (!id || !title) return res.status(400).json({ error: '请填写缺陷ID和标题' });
  if (get('SELECT id FROM defects WHERE id=?', [id])) return res.status(400).json({ error: '缺陷ID已存在' });
  run('INSERT INTO defects (id,title,severity,status,version,relatedReq,assignee,reporter,description,createdAt,logs) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id, title, severity || '一般', status || '新建', version || '', relatedReq || '', assignee || '', reporter || '', description || '', new Date().toISOString().split('T')[0], JSON.stringify(logs || [])]);
  res.json({ message: '创建成功' });
});
app.put('/api/defects/:id', authMiddleware, (req, res) => { const { title, severity, status, version, relatedReq, assignee, reporter, description, logs } = req.body; run('UPDATE defects SET title=?,severity=?,status=?,version=?,relatedReq=?,assignee=?,reporter=?,description=?,logs=? WHERE id=?', [title, severity, status, version || '', relatedReq || '', assignee || '', reporter || '', description || '', JSON.stringify(logs || []), req.params.id]); res.json({ message: '更新成功' }); });
app.delete('/api/defects/:id', authMiddleware, (req, res) => { run('DELETE FROM defects WHERE id=?', [req.params.id]); res.json({ message: '删除成功' }); });

// ==================== Workflows ====================
app.get('/api/workflows', authMiddleware, (req, res) => { res.json(all('SELECT * FROM workflows').map(w => ({ ...w, steps: parseJsonField(w.steps), transitions: parseJsonField(w.transitions) }))); });
app.post('/api/workflows', authMiddleware, (req, res) => {
  const { id, name, type, description, steps, transitions } = req.body;
  if (!id || !name) return res.status(400).json({ error: '请填写流程名称' });
  if (get('SELECT id FROM workflows WHERE id=?', [id])) return res.status(400).json({ error: '流程ID已存在' });
  run('INSERT INTO workflows (id,name,type,description,steps,transitions) VALUES (?,?,?,?,?,?)', [id, name, type || '缺陷', description || '', JSON.stringify(steps || []), JSON.stringify(transitions || [])]);
  res.json({ message: '创建成功' });
});
app.put('/api/workflows/:id', authMiddleware, (req, res) => { const { name, type, description, steps, transitions } = req.body; run('UPDATE workflows SET name=?,type=?,description=?,steps=?,transitions=? WHERE id=?', [name, type, description || '', JSON.stringify(steps || []), JSON.stringify(transitions || []), req.params.id]); res.json({ message: '更新成功' }); });
app.delete('/api/workflows/:id', authMiddleware, (req, res) => { run('DELETE FROM workflows WHERE id=?', [req.params.id]); res.json({ message: '删除成功' }); });

// ==================== Accounts ====================
app.get('/api/accounts', authMiddleware, (req, res) => {
  const allAccounts = all('SELECT username,empId,roleName,enabled,createdAt,lastLogin FROM accounts').map(a => ({ ...a, enabled: !!a.enabled }));

  // 系统管理员：查看所有账号
  if (req.user.roleName === '系统管理员') {
    return res.json(allAccounts);
  }

  // 其他角色：只能查看自己的账号
  const selfAccount = allAccounts.find(a => a.username === req.user.username);
  res.json(selfAccount ? [selfAccount] : []);
});
app.post('/api/accounts', authMiddleware, (req, res) => {
  const { username, password, empId, roleName, enabled } = req.body;
  if (!username) return res.status(400).json({ error: '请填写用户名' });

  // 权限检查：非管理员需要验证能否创建指定角色的账号
  if (req.user.roleName !== '系统管理员') {
    const userLevel = getRoleLevel(req.user.roleName);
    const targetLevel = getRoleLevel(roleName);

    // 只有当目标角色级别 >= 当前用户级别时（数字越小级别越高），才允许创建
    if (targetLevel < userLevel) {
      return res.status(403).json({ error: '您的权限不足，无法创建比自己级别更高的账号' });
    }
  }

  const pe = validatePassword(password); if (pe) return res.status(400).json({ error: pe });
  if (get('SELECT username FROM accounts WHERE username=?', [username])) return res.status(400).json({ error: '用户名已存在' });
  run('INSERT INTO accounts (username,password,empId,roleName,enabled,createdAt,lastLogin) VALUES (?,?,?,?,?,?,?)', [username, bcrypt.hashSync(password, 10), empId || '', roleName || '', enabled !== false ? 1 : 0, new Date().toISOString().split('T')[0], '']);
  res.json({ message: '创建成功' });
});
app.put('/api/accounts/:username', authMiddleware, (req, res) => {
  const { password, empId, roleName, enabled } = req.body;
  const isAdmin = req.user.roleName === '系统管理员';
  const isSelf = req.user.username === req.params.username;

  // 权限检查：只有管理员或账号本人才能修改
  if (!isAdmin && !isSelf) {
    return res.status(403).json({ error: '只能修改自己的账号信息，或由系统管理员操作' });
  }

  // 非管理员不能修改角色
  if (!isAdmin && roleName) {
    return res.status(403).json({ error: '只有管理员才能修改账号角色' });
  }

  // 如果是管理员修改其他人的角色，检查权限
  if (isAdmin && roleName && isSelf === false) {
    const targetLevel = getRoleLevel(roleName);
    const userLevel = getRoleLevel(req.user.roleName);
    if (targetLevel < userLevel) {
      return res.status(403).json({ error: '您的权限不足，无法给账号分配比自己级别更高的角色' });
    }
  }

  if (password) {
    const pe = validatePassword(password);
    if (pe) return res.status(400).json({ error: pe });
    run('UPDATE accounts SET password=?,empId=?,roleName=?,enabled=? WHERE username=?', [bcrypt.hashSync(password, 10), empId || '', roleName || '', enabled !== false ? 1 : 0, req.params.username]);
  }
  else {
    run('UPDATE accounts SET empId=?,roleName=?,enabled=? WHERE username=?', [empId || '', roleName || '', enabled !== false ? 1 : 0, req.params.username]);
  }

  res.json({ message: '更新成功' });
});
app.delete('/api/accounts/:username', authMiddleware, (req, res) => {
  const isAdmin = req.user.roleName === '系统管理员';

  // 权限检查：只有管理员才能删除账号
  if (!isAdmin) {
    return res.status(403).json({ error: '只有系统管理员才能删除账号' });
  }

  // 获取要删除的账号信息，检查其角色级别
  const targetAccount = get('SELECT * FROM accounts WHERE username=?', [req.params.username]);
  if (!targetAccount) return res.status(404).json({ error: '账号不存在' });

  if (req.params.username === 'admin') return res.status(400).json({ error: '不能删除管理员账号' });

  // 检查权限：只能删除级别不高于自己的账号
  const targetLevel = getRoleLevel(targetAccount.roleName);
  const userLevel = getRoleLevel(req.user.roleName);
  if (targetLevel < userLevel) {
    return res.status(403).json({ error: '您的权限不足，无法删除比自己级别更高的账号' });
  }

  run('DELETE FROM accounts WHERE username=?', [req.params.username]);
  res.json({ message: '删除成功' });
});

// ==================== 数据备份（导入/导出 JSON） ====================
const BACKUP_TABLES = ['roles', 'personnel', 'versions', 'requirements', 'defects', 'workflows', 'accounts'];
const _colsCache = {};
function colsOf(t) {
  if (!_colsCache[t]) _colsCache[t] = all('PRAGMA table_info(' + t + ')').map(c => c.name);
  return _colsCache[t];
}
app.get('/api/backup/export', authMiddleware, (req, res) => {
  const tables = {};
  for (const t of BACKUP_TABLES) tables[t] = all('SELECT * FROM ' + t);
  res.setHeader('Content-Disposition', 'attachment; filename="defectpro-backup-' + new Date().toISOString().slice(0, 10) + '.json"');
  res.json({ version: 1, exportedAt: new Date().toISOString(), tables });
});
app.post('/api/backup/import', authMiddleware, (req, res) => {
  try {
    const body = req.body;
    if (!body || !body.tables) return res.status(400).json({ error: '备份文件格式不正确' });
    db.run('BEGIN');
    for (const t of BACKUP_TABLES) {
      const rows = body.tables[t];
      if (!Array.isArray(rows)) continue;
      const validCols = colsOf(t);
      db.run('DELETE FROM ' + t);
      for (const row of rows) {
        const keys = Object.keys(row).filter(k => validCols.includes(k));
        if (!keys.length) continue;
        const placeholders = keys.map(() => '?').join(',');
        const vals = keys.map(k => row[k]);
        db.run('INSERT INTO ' + t + ' (' + keys.join(',') + ') VALUES (' + placeholders + ')', vals);
      }
    }
    db.run('COMMIT');
    saveDb();
    const counts = {};
    for (const t of BACKUP_TABLES) counts[t] = Array.isArray(body.tables[t]) ? body.tables[t].length : 0;
    res.json({ message: '导入成功', counts });
  } catch (e) {
    try { db.run('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: '导入失败：' + e.message });
  }
});

// ==================== Counters ====================
app.get('/api/counters', authMiddleware, (req, res) => {
  const reqMax = get("SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) as m FROM requirements")?.m || 0;
  const bugMax = get("SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) as m FROM defects")?.m || 0;
  res.json({ reqCounter: reqMax + 1, bugCounter: bugMax + 1 });
});

// SPA fallback
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// Start
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🐛 DefectPro 缺陷管理系统已启动！`);
    console.log(`📍 本地访问：http://localhost:${PORT}`);
    console.log(`🔑 默认管理员账号：admin （首次登录后请尽快修改密码）\n`);
  });
}).catch(err => { console.error('数据库初始化失败:', err); process.exit(1); });
