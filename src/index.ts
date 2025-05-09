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
    
    // MongoDB connection options
    const options = {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4,
      retryWrites: true,
      w: 'majority'
    };

    // Direct MongoDB connection URL with updated credentials
    const MONGODB_URI = 'mongodb+srv://vamsi:vamsi123@cluster0.qnzwuai.mongodb.net/travel-form?retryWrites=true&w=majority';

    console.log('Attempting MongoDB connection...');
    const db = await mongoose.connect(MONGODB_URI, options);
    console.log('Successfully connected to MongoDB');
    
    // Test the connection with a simple query
    await mongoose.connection.db.admin().ping();
    console.log('MongoDB ping successful');
    
    cachedDb = db;
    return db;
  } catch (error) {
    const mongoError = error as Error;
    console.error('MongoDB connection error details:', {
      name: mongoError.name,
      message: mongoError.message,
      stack: mongoError.stack,
      code: (mongoError as any).code,
      codeName: (mongoError as any).codeName
    });
    throw new Error(`Database connection failed: ${mongoError.message}`);
  }
}

// Test route to verify API is working
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Travel Form API' });
});

// Health check route
app.get('/api/health', async (req, res) => {
  try {
    await connectToDatabase();
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Database connection failed' });
  }
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
    } catch (error) {
      const dbError = error as Error;
      console.error('Database connection failed:', {
        message: dbError.message,
        stack: dbError.stack
      });
      return res.status(500).json({ 
        error: 'Database connection failed',
        details: dbError.message
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
    } catch (error) {
      const saveError = error as Error;
      console.error('Error saving to database:', {
        message: saveError.message,
        stack: saveError.stack
      });
      return res.status(500).json({ 
        error: 'Failed to save form data',
        details: saveError.message
      });
    }
  } catch (error) {
    const serverError = error as Error;
    console.error('Unhandled error in form submission:', {
      message: serverError.message,
      stack: serverError.stack,
      body: req.body,
      files: req.files ? Object.keys(req.files) : 'No files'
    });
    
    res.status(500).json({ 
      error: 'Failed to submit form',
      details: serverError.message
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
    details: err.message
  });
});

// Only start the server if we're not in a Vercel environment
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

export default app; 