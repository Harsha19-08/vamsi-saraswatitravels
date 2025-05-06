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
  try {
    if (cachedDb) {
      console.log('Using cached database connection');
      return cachedDb;
    }

    console.log('Connecting to MongoDB...');
    console.log('MongoDB URI exists:', !!process.env.MONGODB_URI);
    
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    const db = await mongoose.connect(process.env.MONGODB_URI);
    console.log('Successfully connected to MongoDB');
    cachedDb = db;
    return db;
  } catch (error) {
    console.error('MongoDB connection error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
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
    console.log('Received form submission request');
    
    // Check if files exist in the request
    if (!req.files) {
      console.error('No files were uploaded');
      return res.status(400).json({ error: 'No files were uploaded' });
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    console.log('Files received:', {
      fileKeys: Object.keys(files),
      reviewScreenshot: files.reviewScreenshot ? files.reviewScreenshot[0].originalname : 'missing',
      ticket: files.ticket ? files.ticket[0].originalname : 'missing'
    });

    // Validate required fields
    const requiredFields = ['name', 'email', 'phone', 'dateOfTravel', 'source'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
      console.error('Missing required fields:', missingFields);
      return res.status(400).json({ 
        error: 'Missing required fields', 
        fields: missingFields 
      });
    }

    // Connect to database
    try {
      await connectToDatabase();
    } catch (dbError) {
      console.error('Database connection failed:', dbError);
      return res.status(500).json({ 
        error: 'Database connection failed',
        details: process.env.NODE_ENV === 'development' ? dbError.message : undefined
      });
    }

    if (!files.reviewScreenshot || !files.ticket) {
      console.error('Missing required files');
      return res.status(400).json({ 
        error: 'Both review screenshot and ticket are required',
        received: {
          hasReviewScreenshot: !!files.reviewScreenshot,
          hasTicket: !!files.ticket
        }
      });
    }

    const formData = {
      ...req.body,
      reviewScreenshot: files.reviewScreenshot[0].buffer,
      reviewScreenshotType: files.reviewScreenshot[0].mimetype,
      ticket: files.ticket[0].buffer,
      ticketType: files.ticket[0].mimetype,
    };

    console.log('Creating new TravelForm document with data:', {
      ...formData,
      reviewScreenshot: 'Buffer data',
      ticket: 'Buffer data'
    });

    try {
      const travelForm = new TravelForm(formData);
      await travelForm.save();
      console.log('Successfully saved to database');

      res.status(201).json({ 
        message: 'Form submitted successfully',
        data: {
          ...travelForm.toObject(),
          reviewScreenshot: undefined,
          ticket: undefined
        }
      });
    } catch (saveError) {
      console.error('Error saving to database:', {
        error: saveError instanceof Error ? saveError.message : 'Unknown error',
        stack: saveError instanceof Error ? saveError.stack : undefined
      });
      return res.status(500).json({ 
        error: 'Failed to save form data',
        details: process.env.NODE_ENV === 'development' ? saveError.message : undefined
      });
    }
  } catch (error) {
    console.error('Unhandled error in form submission:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      body: req.body,
      files: req.files ? Object.keys(req.files) : 'No files'
    });
    
    res.status(500).json({ 
      error: 'Failed to submit form',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error handler:', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });
  res.status(500).json({ 
    error: 'Something went wrong!',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
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