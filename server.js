const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
const JWT_SECRET = 'supersecret_upgrader_key';
const DB_PATH = path.join(__dirname, 'db.json');

app.use(cors());
app.use(express.json());

// Отдача статики (HTML, CSS, картинки)
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Вспомогательные функции работы с JSON-БД ---
function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify({ users: [] }, null, 2), 'utf8');
    }
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Ошибка чтения db.json:', err);
    return { users: [] };
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Ошибка записи в db.json:', err);
  }
}

function findUserById(id) {
  return readDB().users.find(u => u.id === id);
}

function findUserByUsername(username) {
  return readDB().users.find(u => u.username === username);
}

function saveUser(user) {
  const db = readDB();
  const index = db.users.findIndex(u => u.id === user.id);
  if (index !== -1) {
    db.users[index] = user;
  } else {
    db.users.push(user);
  }
  writeDB(db);
}

// --- Список товаров ---
const storeSkins = [
  { id: 'st_1', name: 'M4A1 Dragon', price: 1500, rarity: 'arcane', image: '/img/m4a1_dragon.png' },
  { id: 'st_2', name: 'Karambit Gold', price: 12000, rarity: 'nameless', image: '/img/karambit_gold.png' },
  { id: 'st_3', name: 'AKR Treasure', price: 4500, rarity: 'arcane', image: '/img/akr_treasure.png' },
  { id: 'st_4', name: 'AWM Sport', price: 850, rarity: 'legendary', image: '/img/awm_sport.png' },
  { id: 'st_5', name: 'G22 Relic', price: 250, rarity: 'epic', image: '/img/g22_relic.png' },
  { id: 'st_6', name: 'Butterfly Star', price: 8900, rarity: 'nameless', image: '/img/butterfly_star.png' }
];

// --- Middleware авторизации ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Нет авторизации' });

  jwt.verify(token, JWT_SECRET, (err, userPayload) => {
    if (err) return res.status(403).json({ success: false, message: 'Недействительный токен' });
    
    const user = findUserById(userPayload.id);
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    
    req.user = user;
    next();
  });
}

// --- ЭНДПОИНТЫ API ---

// Регистрация
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, message: 'Заполните все поля' });

  if (findUserByUsername(username)) {
    return res.json({ success: false, message: 'Имя уже занято' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = {
    id: Math.floor(100000 + Math.random() * 900000),
    username,
    password: hashedPassword,
    balance: 500,
    inventory: [
      { id: 'inv_' + Date.now() + '_1', name: 'G22 Relic', price: 250, image: '/img/g22_relic.png' }
    ],
    upgradesCount: 0,
    bestDrop: null
  };

  saveUser(newUser);

  const token = jwt.sign({ id: newUser.id, username: newUser.username }, JWT_SECRET);
  res.json({ success: true, token, user: newUser });
});

// Вход
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = findUserByUsername(username);
  if (!user) return res.json({ success: false, message: 'Неверные данные' });

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) return res.json({ success: false, message: 'Неверные данные' });

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  res.json({ success: true, token, user });
});

// Данные профиля
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ success: true, user: req.user });
});

// Покупка скина
app.post('/api/shop/buy', authenticateToken, (req, res) => {
  const { skinId } = req.body;
  const skin = storeSkins.find(s => s.id === skinId);
  if (!skin) return res.json({ success: false, message: 'Скин не найден' });

  if (req.user.balance < skin.price) {
    return res.json({ success: false, message: 'Недостаточно средств' });
  }

  req.user.balance -= skin.price;
  const newInventoryItem = {
    ...skin,
    id: 'inv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)
  };
  req.user.inventory.push(newInventoryItem);

  saveUser(req.user);

  res.json({ success: true, user: req.user });
});

// Активация промокода
app.post('/api/user/promo', authenticateToken, (req, res) => {
  const { code } = req.body;
  if (code.toUpperCase() === 'FREE100') {
    req.user.balance += 100;
    saveUser(req.user);
    return res.json({ success: true, added: 100, newBalance: req.user.balance });
  }
  res.json({ success: false, message: 'Неверный промокод' });
});

// Проведение апгрейда
app.post('/api/upgrade', authenticateToken, (req, res) => {
  const { selectedItemIds, targetItem } = req.body;
  if (!selectedItemIds || !selectedItemIds.length || !targetItem) {
    return res.json({ success: false, message: 'Некорректные данные' });
  }

  const selectedSkins = req.user.inventory.filter(i => selectedItemIds.includes(i.id));
  if (selectedSkins.length !== selectedItemIds.length) {
    return res.json({ success: false, message: 'Предметы не найдены в инвентаре' });
  }

  const totalInputSum = selectedSkins.reduce((sum, item) => sum + item.price, 0);
  const chance = (totalInputSum / targetItem.price) * 100;

  if (chance > 70) {
    return res.json({ success: false, message: 'Шанс превышает допустимые 70%' });
  }

  req.user.inventory = req.user.inventory.filter(i => !selectedItemIds.includes(i.id));
  req.user.upgradesCount = (req.user.upgradesCount || 0) + 1;

  const rolled = Math.random() * 100;
  const isWin = rolled <= chance;

  if (isWin) {
    const newItem = {
      ...targetItem,
      id: 'inv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)
    };
    req.user.inventory.push(newItem);

    if (!req.user.bestDrop || newItem.price > req.user.bestDrop.price) {
      req.user.bestDrop = newItem;
    }
  }

  saveUser(req.user);

  res.json({
    success: true,
    isWin,
    rolled,
    updatedInventory: req.user.inventory,
    bestDrop: req.user.bestDrop
  });
});

app.listen(PORT, () => {
  console.log(`Сервер успешно запущен: http://localhost:${PORT}`);
});
