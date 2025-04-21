const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt'); // Currently unused – consider removing if not needed
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const stream = require('stream');

dotenv.config();

const app = express();
const port = 3002;

// Supabase Client Configuration
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-strong-secret-key';
const JWT_EXPIRES_IN = '2h';

// CORS Middleware
// Update CORS middleware to:
app.use(cors({
  origin: [
    'https://mbayestark.github.io', // Production frontend
    'http://localhost:3002' // Local development (assuming frontend port)
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Body parsing and static files
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// File Upload Configuration
const upload = multer({ storage: multer.memoryStorage() });

// JWT Authentication Middleware
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    console.log('Authorization header missing');
    return res.sendStatus(401);
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log('JWT verification failed:', err.message);
      return res.sendStatus(403);
    }

    req.user = user;
    next();
  });
};

// === Auth Endpoints ===

// Register
app.post('/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;

    // Create user in Supabase Auth
    const { data: { user }, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username }
      }
    });

    if (authError) throw authError;

    // Create user profile
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        user_id: user.id,
        username
      });

    if (profileError) throw profileError;

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(201).json({ token });

  } catch (error) {
    console.error('Registration failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: { user }, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    const token = jwt.sign(
      { userId: user.id },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({ token });

  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// === Protected Upload Endpoint ===
app.post('/upload', authenticateJWT, upload.single('media'), async (req, res) => {
  try {
    const { text } = req.body;
    const file = req.file;
    const userId = req.user.userId;

    if (!text || !file) {
      return res.status(400).json({ error: 'Missing text or media file' });
    }

    const fileName = `uploads/users/${userId}/${Date.now()}_${file.originalname}`;

    const uploadResult = await supabase.storage
      .from('reels')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        cacheControl: '3600'
      });

    if (uploadResult.error) {
      console.error('Supabase storage error:', uploadResult.error);
      return res.status(500).json({ error: 'File upload failed' });
    }

    const publicUrl = supabase.storage
      .from('reels')
      .getPublicUrl(fileName).data.publicUrl;

    // Insert post into DB
    const { data: post, error: postError } = await supabase
      .from('posts')
      .insert({
        user_id: userId,
        content: text,
        media_url: publicUrl
      })
      .select()
      .single();

    if (postError) {
      console.error('Database insert error:', postError);
      return res.status(500).json({ error: 'Database error' });
    }

    res.json(post);

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// === Public Videos Endpoint ===
app.get('/videos', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('posts')
      .select(`
        id,
        content,
        media_url,
        created_at,
        profiles:user_id (username, phone)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase query error:', error);
      return res.status(502).json({ error: 'Database query failed' });
    }

    if (!data.length) {
      return res.status(404).json({ error: 'No posts found' });
    }

    res.json(data);

  } catch (error) {
    console.error('Videos fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// === Static HTML Routes ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname,'index.html'));
});

app.get('/reels', (req, res) => {
  res.sendFile(path.join(__dirname, 'reels.html'));
});

app.get('/log-sign', (req, res) => {
  res.sendFile(path.join(__dirname, 'log-sign.html'));
});

app.get('/uploadPage', (req, res) => {
  res.sendFile(path.join(__dirname, 'upload.html'));
});
app.get('/form', (req, res) => {
  res.sendFile(path.join(__dirname, 'form.html'));
});

// Start Server
app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});
