const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
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
   
// Configure CORS middleware (add before routes)
app.use(cors({
  origin: 'http://localhost:3002', // Update with your frontend origin
  credentials: true
}));

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'Front')));

// File Upload Configuration
const upload = multer({ storage: multer.memoryStorage() });

// Authentication Middleware
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    console.log('No authorization header');
    return res.sendStatus(401);
  }

  const token = authHeader.split(' ')[1];
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.log('JWT verification failed:', err.message);
      return res.sendStatus(403);
    }
    
    console.log('Authenticated user:', user.userId);
    req.user = user;
    next();
  });
};
// Auth Endpoints
app.post('/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;

    // Create user in Supabase Auth
    const { data: { user }, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username
        }
      }
    });

    if (authError) throw authError;

    // Create profile in public schema
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
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: { user }, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({ token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Protected Upload Endpoint
app.post('/upload', authenticateJWT, upload.single('media'), async (req, res) => {
  try {
    const { text } = req.body;
    const file = req.file;
    const userId = req.user.userId;

    // Validate required fields
    if (!text || !file) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log('Upload request from user:', userId);
    console.log('File details:', {
      name: file.originalname,
      type: file.mimetype,
      size: file.size
    });

    // Upload to Supabase Storage
    const fileName = `uploads/users/${userId}/${Date.now()}_${file.originalname}`;
    const bufferStream = new stream.PassThrough();
    bufferStream.end(file.buffer);

    const uploadResult = await supabase.storage
      .from('reels')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        cacheControl: '3600'
      });

    if (uploadResult.error) {
      console.error('Storage upload error:', uploadResult.error);
      return res.status(500).json({ error: 'File upload failed' });
    }

    // Get public URL
    const publicUrl = supabase.storage
    .from('reels')
    .getPublicUrl(fileName).data.publicUrl;


    // Create post in database
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
      console.error('Database error:', postError);
      return res.status(500).json({ error: 'Database operation failed' });
    }

    console.log('Upload successful for user:', userId);
    res.json(post);

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public Posts Endpoint
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
      console.error('Supabase error:', error);
      return res.status(502).json({ error: 'Database connection failed' });
    }

    if (!data.length) {
      return res.status(404).json({ error: 'No posts found' });
    }

    res.json(data);

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Static File Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'Front', 'ex.html'));
});

app.get('/reels', (req, res) => {
  res.sendFile(path.join(__dirname, 'Front', 'reels.html'));
});

app.get('/log-sign', (req, res) => {
  res.sendFile(path.join(__dirname, 'Front', 'log-sign.html'));
});



app.get('/uploadPage', (req, res) => {
  res.sendFile(path.join(__dirname, 'Front', 'upload.html'));
});


app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});