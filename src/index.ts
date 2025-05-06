import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import morgan from 'morgan';
import serverless from 'serverless-http';

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

// ✅ Use in-memory storage instead of disk
const upload = multer({
  storage: multer.memoryStorage(),
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
  reviewScreenshotBuffer: Buffer,
  ticketBuffer: Buffer,
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
      reviewScreenshotBuffer: files.reviewScreenshot[0].buffer,
      ticketBuffer: files.ticket[0].buffer,
    };

    const travelForm = new TravelForm(formData);
    await travelForm.save();

    res.status(201).json({ message: 'Form submitted successfully', data: travelForm._id });
  } catch (error) {
    console.error('Error submitting form:', error);
    res.status(500).json({ error: 'Failed to submit form' });
  }
});

// Test route
app.get('/api/health', (req, res) => {
  res.send('✅ Server is live on Vercel!');
});

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Export handler for Vercel
export const handler = serverless(app);
