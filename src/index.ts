import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import dotenv from 'dotenv';
import morgan from 'morgan';
import serverless from 'serverless-http';
import fs from 'fs';

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(morgan('dev'));

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG and PDF files are allowed.'));
    }
  },
});

// MongoDB connection (avoid reconnecting on every call)
let dbConnected = false;
async function connectDB() {
  if (!dbConnected) {
    await mongoose.connect(process.env.MONGODB_URI!);
    dbConnected = true;
    console.log('✅ Connected to MongoDB');
  }
}

// Schema
const travelFormSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  dateOfTravel: Date,
  source: String,
  reviewScreenshotPath: String,
  ticketPath: String,
  createdAt: { type: Date, default: Date.now },
});
const TravelForm = mongoose.models.TravelForm || mongoose.model('TravelForm', travelFormSchema);

// Routes
app.post('/api/submit-form', upload.fields([
  { name: 'reviewScreenshot', maxCount: 1 },
  { name: 'ticket', maxCount: 1 },
]), async (req, res) => {
  try {
    await connectDB();

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    if (!files.reviewScreenshot || !files.ticket) {
      return res.status(400).json({ error: 'Both review screenshot and ticket are required' });
    }

    const formData = {
      ...req.body,
      reviewScreenshotPath: files.reviewScreenshot[0].path,
      ticketPath: files.ticket[0].path,
    };

    const travelForm = new TravelForm(formData);
    await travelForm.save();

    res.status(201).json({ message: 'Form submitted successfully', data: travelForm });
  } catch (error) {
    console.error('Error submitting form:', error);
    res.status(500).json({ error: 'Failed to submit form' });
  }
});

// Test route to verify deployment
app.get('/api/health', (req, res) => {
  res.send('✅ Server is live on Vercel!');
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});


// Export as serverless handler
export const handler = serverless(app);
