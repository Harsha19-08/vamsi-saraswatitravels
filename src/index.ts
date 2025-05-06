import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import dotenv from 'dotenv';
import morgan from 'morgan';

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors({
  origin: ['https://vamsi-frontend.vercel.app', 'http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Origin'],
  exposedHeaders: ['Access-Control-Allow-Origin']
}));
app.use(express.json());
app.use(morgan('dev'));

// Configure multer for file uploads with memory storage for Vercel
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG and PDF files are allowed.'));
    }
  },
});

// MongoDB Schema
const travelFormSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  dateOfTravel: { type: Date, required: true },
  source: { type: String, required: true },
  reviewScreenshot: { type: Buffer, required: true },
  reviewScreenshotType: { type: String, required: true },
  ticket: { type: Buffer, required: true },
  ticketType: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const TravelForm = mongoose.model('TravelForm', travelFormSchema);

// Connect to MongoDB
let cachedDb: typeof mongoose | null = null;

async function connectToDatabase() {
  if (cachedDb) {
    return cachedDb;
  }

  const db = await mongoose.connect(process.env.MONGODB_URI!);
  cachedDb = db;
  return db;
}

// Root route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Travel Form API' });
});

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Form submission route
app.post('/api/submit-form', upload.fields([
  { name: 'reviewScreenshot', maxCount: 1 },
  { name: 'ticket', maxCount: 1 },
]), async (req, res) => {
  try {
    await connectToDatabase();
    
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    
    if (!files.reviewScreenshot || !files.ticket) {
      return res.status(400).json({ error: 'Both review screenshot and ticket are required' });
    }

    const formData = {
      ...req.body,
      reviewScreenshot: files.reviewScreenshot[0].buffer,
      reviewScreenshotType: files.reviewScreenshot[0].mimetype,
      ticket: files.ticket[0].buffer,
      ticketType: files.ticket[0].mimetype,
    };

    const travelForm = new TravelForm(formData);
    await travelForm.save();

    res.status(201).json({ 
      message: 'Form submitted successfully',
      data: {
        ...travelForm.toObject(),
        reviewScreenshot: undefined,
        ticket: undefined
      }
    });
  } catch (error) {
    console.error('Error submitting form:', error);
    res.status(500).json({ error: 'Failed to submit form' });
  }
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler for undefined routes
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Only start the server if we're not in a Vercel environment
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

export default app; 