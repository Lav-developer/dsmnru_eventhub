import React, { useState, useEffect, useRef } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  useParams,
  useNavigate,
  useSearchParams
} from 'react-router-dom';
import {
  Calendar,
  UserCheck,
  CheckCircle,
  AlertTriangle,
  QrCode,
  FileText,
  Mail,
  Plus,
  Trash2,
  Copy,
  Building,
  Users,
  
  ShieldAlert,
  
  LogOut,
  LogIn,
  Search,
  Check,
  
  Upload,
  Download,
  Activity,
  Heart,
  
  AlertCircle,
  RefreshCw,
  
  Briefcase,
  ChevronRight,
  UserPlus
} from 'lucide-react';
import { apiRequest } from './utils/api';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { Html5QrcodeScanner } from 'html5-qrcode';

// ==========================================
// TYPES
// ==========================================
interface User {
  id: string;
  email: string;
  full_name: string;
  role: 'super_admin' | 'department_head' | 'coordinator' | 'volunteer';
  status: 'pending' | 'active' | 'suspended';
  phone?: string;
  created_at: string;
}

interface Department {
  id: string;
  name: string;
  code: string;
  description?: string;
}

interface Event {
  id: string;
  slug: string;
  name: string;
  short_name: string;
  event_type: string;
  department_id?: string;
  department_name?: string;
  department_code?: string;
  theme?: string;
  description?: string;
  banner_url?: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  venue: string;
  format: 'online' | 'offline' | 'hybrid';
  meeting_link?: string;
  registration_type: 'built_in' | 'external';
  external_form_url?: string;
  status: 'DRAFT' | 'PUBLISHED' | 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED' | 'ONGOING' | 'COMPLETED' | 'ARCHIVED';
  google_drive_folder_url?: string;
  created_at: string;
}

interface Participant {
  id: string;
  registration_id: string;
  full_name: string;
  email: string;
  phone: string;
  college: string;
  department: string;
  course: string;
  year: string;
  designation: string;
  created_at: string;
}

interface ScheduleItem {
  id: string;
  start_time: string;
  end_time: string;
  title: string;
  description?: string;
  speaker_name?: string;
  location?: string;
}

interface Speaker {
  id: string;
  name: string;
  designation: string;
  institution: string;
  photo_url?: string;
  biography?: string;
}

interface Announcement {
  id: string;
  title: string;
  content: string;
  priority: 'low' | 'normal' | 'high';
  published_at: string;
}

interface Resource {
  id: string;
  name: string;
  quantity: number;
  remaining: number;
  eligibility: 'all' | 'attendees';
  claim_limit: number;
  status: 'active' | 'inactive';
}

interface AuditLog {
  id: string;
  user_email: string | null;
  action: string;
  target_type: string;
  details: string;
  timestamp: string;
}

// ==========================================
// CORE FRONTEND COMPONENT
// ==========================================
export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Fetch current session status on mount
  useEffect(() => {
    apiRequest<any>('/auth/me')
      .then((data) => {
        if (data && data.user) {
          setCurrentUser(data.user);
        } else {
          setCurrentUser(null);
        }
      })
      .catch(() => {
        setCurrentUser(null);
      })
      .finally(() => {
        setAuthLoading(false);
      });
  }, []);

  const handleLogout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
      setCurrentUser(null);
      window.location.href = '/';
    } catch (err: any) {
      alert(err.message || 'Logout failed');
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
        <div className="relative w-20 h-20">
          <div className="absolute inset-0 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
        </div>
        <p className="mt-4 text-slate-600 font-medium">DSMNRU EventHub - Loading secure portal...</p>
      </div>
    );
  }

  return (
    <Router>
      <div className="flex flex-col min-h-screen">
        {/* Navigation Bar */}
        <nav className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex items-center">
                <Link to="/" className="flex items-center space-x-2">
                  <span className="text-2xl">🎓</span>
                  <span className="font-bold text-xl tracking-tight text-slate-800">DSMNRU <span className="text-primary-600">EventHub</span></span>
                </Link>
                <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                  <Link to="/" className="text-slate-600 hover:text-primary-600 px-1 py-2 text-sm font-medium">Home</Link>
                  {currentUser && (
                    <Link to="/dashboard" className="text-slate-600 hover:text-primary-600 px-1 py-2 text-sm font-medium">Dashboard</Link>
                  )}
                </div>
              </div>
              <div className="flex items-center space-x-4">
                {currentUser ? (
                  <div className="flex items-center space-x-3">
                    <div className="text-right hidden md:block">
                      <p className="text-sm font-semibold text-slate-800">{currentUser.full_name}</p>
                      <p className="text-xs text-slate-500 capitalize">{currentUser.role.replace('_', ' ')}</p>
                    </div>
                    <Link to="/dashboard" className="bg-primary-50 text-primary-700 hover:bg-primary-100 px-3 py-2 rounded-md text-sm font-semibold transition">
                      Portal
                    </Link>
                    <button onClick={handleLogout} className="text-slate-500 hover:text-red-600 p-2 rounded-md transition" title="Logout">
                      <LogOut className="w-5 h-5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center space-x-3">
                    <Link to="/login" className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-md text-sm font-semibold shadow-sm transition">
                      Staff Login
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </nav>

        {/* Core Layout Pages */}
        <main className="flex-grow">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login setCurrentUser={setCurrentUser} />} />
            <Route path="/register" element={<Register />} />
            <Route path="/setup-password" element={<SetupPassword />} />
            <Route path="/events/:slug" element={<EventPage />} />
            <Route path="/verify/:certificateId" element={<CertificateVerifyPage />} />
            <Route path="/dashboard/*" element={currentUser ? <Dashboard currentUser={currentUser} /> : <Link to="/login" />} />
          </Routes>
        </main>

        {/* Footer */}
        <footer className="bg-slate-900 text-slate-400 py-12 border-t border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              <div className="md:col-span-2">
                <div className="flex items-center space-x-2 text-white mb-4">
                  <span className="text-3xl">🎓</span>
                  <span className="font-bold text-xl tracking-tight">DSMNRU <span className="text-primary-400">EventHub</span></span>
                </div>
                <p className="text-sm max-w-sm">
                  Dr. Shakuntala Misra National Rehabilitation University (DSMNRU), Lucknow. 
                  One enterprise platform managing conferences, seminars, webinars, and certificates with ₹0 hosting fees.
                </p>
              </div>
              <div>
                <h3 className="text-white font-semibold text-sm mb-4">Lifecycle</h3>
                <ul className="space-y-2 text-sm">
                  <li>Create Wizard</li>
                  <li>Opaque QR Scanner</li>
                  <li>Browser Cert-ZIP</li>
                  <li>Dynamic Email campaigns</li>
                </ul>
              </div>
              <div>
                <h3 className="text-white font-semibold text-sm mb-4">Security</h3>
                <ul className="space-y-2 text-sm">
                  <li>Role-Based Access Control</li>
                  <li>No PII in QR Codes</li>
                  <li>CSV Injection Protection</li>
                  <li>Strict Rate Limiting</li>
                </ul>
              </div>
            </div>
            <hr className="border-slate-800 my-8" />
            <div className="flex flex-col sm:flex-row justify-between items-center text-xs">
              <p>&copy; {new Date().getFullYear()} DSMNRU. All rights reserved.</p>
              <p className="flex items-center mt-2 sm:mt-0">
                Crafted with <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500 mx-1 animate-pulse" /> for academic excellence
              </p>
            </div>
          </div>
        </footer>
      </div>
    </Router>
  );
}

// ==========================================
// PAGE: PUBLIC HOME
// ==========================================
function Home() {
  const [events, setEvents] = useState<Event[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [verifyId, setVerifyId] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      apiRequest<{ events: Event[] }>('/events?limit=6'),
      apiRequest<Department[]>('/departments')
    ])
      .then(([eventData, deptData]) => {
        setEvents(eventData.events || []);
        setDepartments(deptData || []);
      })
      .catch((err: any) => {
        setError(err.message || 'Failed to load platform data');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const handleVerifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyId.trim()) return;
    navigate(`/verify/${verifyId.trim()}`);
  };

  return (
    <div>
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-primary-950 text-white py-20 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="max-w-3xl">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-primary-500/20 text-primary-300 border border-primary-500/30 mb-6">
              🏫 DSMNRU Departments Academic Portal
            </span>
            <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-none mb-6">
              One platform for every <span className="text-primary-400">academic event</span>.
            </h1>
            <p className="text-lg sm:text-xl text-slate-300 mb-8 max-w-2xl leading-relaxed">
              Create events, track registrations, verify attendance in real-time, generate bulk certificates client-side, and coordinate campus workflows. High performance, zero costs.
            </p>
            <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
              <a href="#events" className="bg-primary-600 hover:bg-primary-700 text-white text-center px-6 py-3.5 rounded-lg font-bold shadow-md transition">
                Explore Active Events
              </a>
              <a href="#verify" className="bg-white/10 hover:bg-white/20 text-white text-center border border-white/20 px-6 py-3.5 rounded-lg font-bold transition">
                Verify Certificate
              </a>
            </div>
          </div>
        </div>
        <div className="absolute right-0 bottom-0 top-0 w-1/3 bg-primary-600/10 blur-3xl rounded-full"></div>
      </section>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-20">
        
        {/* Verification Widget */}
        <section id="verify" className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 max-w-3xl mx-auto relative -mt-24 z-20">
          <h2 className="text-xl font-bold text-slate-800 mb-2">Instant Certificate Authenticity Validation</h2>
          <p className="text-sm text-slate-500 mb-6">
            Enter the unique ID printed on your DSMNRU Event Certificate (e.g. <code>DSMNRU-2026-X8Y7Z6W4</code>) to check its record directly against our cryptographic logs.
          </p>
          <form onSubmit={handleVerifySubmit} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-grow">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
                <FileText className="w-5 h-5" />
              </span>
              <input
                type="text"
                placeholder="DSMNRU-YYYY-XXXXXXXX"
                value={verifyId}
                onChange={(e) => setVerifyId(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-slate-800 font-mono"
              />
            </div>
            <button type="submit" className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-3 rounded-lg font-bold transition flex items-center justify-center space-x-2">
              <CheckCircle className="w-5 h-5" />
              <span>Verify Now</span>
            </button>
          </form>
        </section>

        {/* Loading / Error States */}
        {loading && (
          <div className="flex justify-center items-center py-12">
            <RefreshCw className="w-8 h-8 text-primary-600 animate-spin" />
            <span className="ml-3 text-slate-600 font-medium">Gathering academic schedule...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 max-w-2xl mx-auto flex items-center space-x-3">
            <AlertTriangle className="w-6 h-6 flex-shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {/* Upcoming Events Section */}
        {!loading && !error && (
          <section id="events" className="space-y-6">
            <div className="flex justify-between items-end border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-3xl font-extrabold text-slate-800">Academic Schedule</h2>
                <p className="text-slate-500 mt-1">Discover upcoming guest lectures, FDPs, symposia, workshops, and student conventions.</p>
              </div>
              <span className="text-sm font-bold text-primary-600 bg-primary-50 px-3 py-1.5 rounded-full hidden sm:inline-block">
                {events.length} Active Events
              </span>
            </div>

            {events.length === 0 ? (
              <div className="bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-12 text-center max-w-lg mx-auto">
                <Calendar className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <h3 className="font-bold text-slate-700 text-lg">No Active Events Found</h3>
                <p className="text-slate-500 text-sm mt-1">There are no upcoming events listed right now. Check back shortly!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {events.map((evt) => (
                  <div key={evt.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-md transition flex flex-col h-full">
                    <div className="bg-slate-100 h-48 relative flex items-center justify-center text-slate-400">
                      {evt.banner_url ? (
                        <img src={evt.banner_url} alt={evt.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="text-center p-4">
                          <span className="text-4xl block mb-2">🎓</span>
                          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{evt.event_type}</span>
                        </div>
                      )}
                      <div className="absolute top-3 right-3 bg-primary-600 text-white text-xs font-bold px-2.5 py-1.5 rounded-full capitalize">
                        {evt.status.toLowerCase().replace('_', ' ')}
                      </div>
                    </div>
                    <div className="p-6 flex-grow flex flex-col justify-between">
                      <div className="space-y-3">
                        <span className="text-xs font-bold text-primary-600 uppercase tracking-wider">
                          {evt.department_code || 'DSMNRU'}
                        </span>
                        <h3 className="font-extrabold text-xl text-slate-800 leading-tight hover:text-primary-600 transition">
                          <Link to={`/events/${evt.slug}`}>{evt.name}</Link>
                        </h3>
                        <p className="text-slate-600 text-sm line-clamp-3">
                          {evt.description || 'No event description provided.'}
                        </p>
                      </div>
                      <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                        <span className="flex items-center font-medium">
                          <Calendar className="w-3.5 h-3.5 mr-1 text-primary-500" />
                          {evt.start_date}
                        </span>
                        <span className="capitalize font-semibold bg-slate-100 px-2 py-1 rounded text-slate-700">
                          {evt.format}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Capabilities Section */}
        <section className="bg-slate-50 border border-slate-200 rounded-3xl p-8 sm:p-12">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <h2 className="text-3xl font-extrabold text-slate-800">Designed for Academic Excellence</h2>
            <p className="text-slate-500 mt-2">
              A comprehensive list of capabilities engineered to host state, national, and international level academic conventions.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm space-y-3">
              <div className="w-10 h-10 rounded-lg bg-primary-100 text-primary-700 flex items-center justify-center text-lg font-bold">1</div>
              <h3 className="font-bold text-slate-800">Dynamic Multi-Step Events Creator</h3>
              <p className="text-sm text-slate-500">Coordinate and publish webinars, physical workshops, and conferences easily with customized inputs selection.</p>
            </div>
            <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm space-y-3">
              <div className="w-10 h-10 rounded-lg bg-primary-100 text-primary-700 flex items-center justify-center text-lg font-bold">2</div>
              <h3 className="font-bold text-slate-800">Secure repeated CSV Imports</h3>
              <p className="text-sm text-slate-500">Import Google Forms or external sheets multiple times safely. The system maps columns, ignores duplicates, and tracks history.</p>
            </div>
            <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm space-y-3">
              <div className="w-10 h-10 rounded-lg bg-primary-100 text-primary-700 flex items-center justify-center text-lg font-bold">3</div>
              <h3 className="font-bold text-slate-800">Browser-Side Heavy PDF ZIP Engine</h3>
              <p className="text-sm text-slate-500">Generate hundreds of high-fidelity PDF certificates (supporting Hindi/Indian languages) in browser and download as a ZIP file instantly.</p>
            </div>
            <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm space-y-3">
              <div className="w-10 h-10 rounded-lg bg-primary-100 text-primary-700 flex items-center justify-center text-lg font-bold">4</div>
              <h3 className="font-bold text-slate-800">Opaque QR Attendance & Food Claims</h3>
              <p className="text-sm text-slate-500">Lightweight browser decoder scans opaque tokens. D1 databases unique constraints protect counters against replay attacks.</p>
            </div>
            <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm space-y-3">
              <div className="w-10 h-10 rounded-lg bg-primary-100 text-primary-700 flex items-center justify-center text-lg font-bold">5</div>
              <h3 className="font-bold text-slate-800">Dynamic email delivery campaigns</h3>
              <p className="text-sm text-slate-500">Build email reminders, updates, and templates safely. Confirmation panels and exponential backoff retry queue prevent quota exhausts.</p>
            </div>
            <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm space-y-3">
              <div className="w-10 h-10 rounded-lg bg-primary-100 text-primary-700 flex items-center justify-center text-lg font-bold">6</div>
              <h3 className="font-bold text-slate-800">Observability Metrics</h3>
              <p className="text-sm text-slate-500">Audit every coordination action in database logs. Admins monitor server latency and trace failed email delivery issues easily.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ==========================================
// PAGE: LOGIN PORTAL
// ==========================================
function Login({ setCurrentUser }: { setCurrentUser: (user: User | null) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setLoading(true);
    setError(null);

    try {
      const data = await apiRequest<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      
      setCurrentUser(data.user);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8 space-y-6">
        <div className="text-center space-y-2">
          <span className="text-4xl block">🔑</span>
          <h2 className="text-2xl font-extrabold text-slate-800">DSMNRU Staff Login</h2>
          <p className="text-sm text-slate-500">Provisioned Super Admin, Department Head, Coordinator, and Volunteer accounts</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Department Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. computer.science@dsmnru.ac.in"
              className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-slate-800 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Secure Access Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-slate-800 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-600 hover:bg-primary-700 text-white py-3 rounded-lg font-bold text-sm shadow-sm transition flex items-center justify-center space-x-2"
          >
            {loading ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <LogIn className="w-5 h-5" />
                <span>Access Portal</span>
              </>
            )}
          </button>
        </form>

        <p className="text-center text-xs text-slate-400">Staff accounts are provisioned by the role hierarchy. Participants register on event pages only.</p>
      </div>
    </div>
  );
}

// ==========================================
// PAGE: REGISTER ACCOUNT
// ==========================================
function SetupPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiRequest('/auth/setup-password', {
        method: 'POST',
        body: JSON.stringify({ token, password })
      });
      setSuccess('Password set. You can now log in.');
    } catch (err: any) {
      setError(err.message || 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8 space-y-6">
        <h2 className="text-2xl font-extrabold text-slate-800 text-center">Set your password</h2>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-700">{success}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (8+ characters)" className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-sm" />
          <button type="submit" disabled={loading} className="w-full bg-primary-600 text-white py-3 rounded-lg font-bold text-sm">Save password</button>
        </form>
        <Link to="/login" className="block text-center text-xs text-primary-600">Go to login</Link>
      </div>
    </div>
  );
}

function Register() {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !fullName || !password) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await apiRequest('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email,
          full_name: fullName,
          password,
          phone
        })
      });
      setSuccess('Bootstrap Super Admin created. Staff accounts must be provisioned from the portal.');
      setEmail('');
      setFullName('');
      setPassword('');
      setPhone('');
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8 space-y-6">
        <div className="text-center space-y-2">
          <span className="text-4xl block">🎓</span>
          <h2 className="text-2xl font-extrabold text-slate-800">DSMNRU Account Sign Up</h2>
          <p className="text-sm text-slate-500">First-user bootstrap only. Role cannot be chosen. Public staff signup is disabled.</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-700 text-sm flex items-center space-x-2">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <span className="font-medium">{success}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Full Name</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Dr. Ramesh Kumar"
              className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-slate-800 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Academic Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. ramesh.kumar@dsmnru.edu.in"
              className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-slate-800 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Secure Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-slate-800 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Phone (Optional)</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 9876543210"
              className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:bot-slate-800 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-600 hover:bg-primary-700 text-white py-3 rounded-lg font-bold text-sm shadow-sm transition flex items-center justify-center space-x-2"
          >
            {loading ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <UserPlus className="w-5 h-5" />
                <span>Submit Account Request</span>
              </>
            )}
          </button>
        </form>

        <div className="text-center pt-2">
          <Link to="/login" className="text-xs font-semibold text-primary-600 hover:text-primary-700">
            Already have an account? Log in here &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// PAGE: PUBLIC EVENT VIEW & BUILT-IN REGISTER
// ==========================================
function EventPage() {
  const { slug } = useParams<{ slug: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form registration state (built_in mode)
  const [regFullName, setRegFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regCollege, setRegCollege] = useState('');
  const [regDept, setRegDept] = useState('');
  const [regCourse, setRegCourse] = useState('');
  const [regYear, setRegYear] = useState('');
  const [regDesignation, setRegDesignation] = useState('Student');
  const [regSuccess, setRegSuccess] = useState<{ id: string; registrationId: string } | null>(null);
  const [regError, setRegError] = useState<string | null>(null);
  const [regLoading, setRegLoading] = useState(false);

  useEffect(() => {
    if (!slug) return;

    apiRequest<Event>(`/events/${slug}`)
      .then((evtData) => {
        setEvent(evtData);
        return Promise.all([
          apiRequest<ScheduleItem[]>(`/schedule/events/${evtData.id}/schedule`),
          apiRequest<Speaker[]>(`/speakers/events/${evtData.id}/speakers`),
          apiRequest<Announcement[]>(`/announcements/events/${evtData.id}/announcements`)
        ]);
      })
      .then(([sch, spk, ann]) => {
        setSchedule(sch || []);
        setSpeakers(spk || []);
        setAnnouncements(ann || []);
      })
      .catch((err: any) => {
        setError(err.message || 'Failed to fetch event data');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [slug]);

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event) return;

    setRegLoading(true);
    setRegError(null);
    setRegSuccess(null);

    try {
      const data = await apiRequest<any>(`/registrations/events/${event.id}/register`, {
        method: 'POST',
        body: JSON.stringify({
          full_name: regFullName,
          email: regEmail,
          phone: regPhone,
          college: regCollege,
          department: regDept,
          course: regCourse,
          year: regYear,
          designation: regDesignation,
          custom_responses: {}
        })
      });

      setRegSuccess({
        id: data.id,
        registrationId: data.registrationId
      });

      // Clear form
      setRegFullName('');
      setRegEmail('');
      setRegPhone('');
      setRegCollege('');
      setRegDept('');
      setRegCourse('');
      setRegYear('');
    } catch (err: any) {
      setRegError(err.message || 'Registration failed. Verify details.');
    } finally {
      setRegLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <RefreshCw className="w-10 h-10 text-primary-600 animate-spin mx-auto mb-4" />
        <p className="text-slate-600">Gathering details for academic panel...</p>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center space-y-4">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
        <h2 className="text-2xl font-bold text-slate-800">Event Not Found</h2>
        <p className="text-slate-500">{error || 'This academic session could not be located on our platform.'}</p>
        <Link to="/" className="inline-block bg-primary-600 text-white px-5 py-2.5 rounded-lg font-bold">
          Go Back Home
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 min-h-screen">
      {/* Banner & Header */}
      <div className="bg-slate-900 text-white relative py-16 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 space-y-4">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-primary-500/20 text-primary-300 border border-primary-500/30">
            {event.event_type.toUpperCase()}
          </span>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight max-w-4xl leading-tight">
            {event.name}
          </h1>
          {event.theme && (
            <p className="text-primary-300 text-lg sm:text-xl font-medium tracking-wide">
              Theme: {event.theme}
            </p>
          )}
          <div className="flex flex-wrap gap-4 text-sm text-slate-300 pt-2">
            <span className="flex items-center">
              <Calendar className="w-4.5 h-4.5 mr-1.5 text-primary-400" />
              {event.start_date} to {event.end_date}
            </span>
            <span className="flex items-center uppercase bg-white/10 px-2 py-0.5 rounded text-xs font-semibold">
              {event.format}
            </span>
            <span className="flex items-center font-medium">
              📍 {event.venue}
            </span>
          </div>
        </div>
        <div className="absolute right-0 bottom-0 top-0 w-1/4 bg-primary-600/10 blur-3xl rounded-full"></div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Content Column */}
          <div className="lg:col-span-2 space-y-12">
            
            {/* Description */}
            <section className="bg-white border border-slate-200 rounded-xl p-8 space-y-4 shadow-sm">
              <h2 className="text-2xl font-bold text-slate-800 border-b pb-2">Event Overview</h2>
              <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-wrap">
                {event.description || 'No detailed description available.'}
              </p>
            </section>

            {/* Announcements */}
            {announcements.length > 0 && (
              <section className="space-y-4">
                <h2 className="text-2xl font-bold text-slate-800">Latest Bulletins</h2>
                <div className="space-y-3">
                  {announcements.map((ann) => (
                    <div key={ann.id} className="bg-amber-50 border border-amber-200 rounded-xl p-6 shadow-sm space-y-2">
                      <div className="flex justify-between items-start">
                        <h3 className="font-bold text-slate-800 text-sm">{ann.title}</h3>
                        <span className="text-xs uppercase font-bold bg-amber-200 text-amber-800 px-2 py-0.5 rounded">
                          {ann.priority}
                        </span>
                      </div>
                      <p className="text-slate-600 text-xs whitespace-pre-wrap leading-relaxed">{ann.content}</p>
                      <span className="text-[10px] text-slate-400 block pt-1">
                        Posted: {new Date(ann.published_at).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Speakers */}
            {speakers.length > 0 && (
              <section className="space-y-4">
                <h2 className="text-2xl font-bold text-slate-800">Distinguished Panel</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {speakers.map((spk) => (
                    <div key={spk.id} className="bg-white border border-slate-200 rounded-xl p-6 flex space-x-4 shadow-sm">
                      <div className="w-16 h-16 rounded-full bg-slate-100 flex-shrink-0 flex items-center justify-center text-2xl">
                        👤
                      </div>
                      <div className="space-y-1 min-w-0">
                        <h3 className="font-bold text-slate-800 text-sm truncate">{spk.name}</h3>
                        <p className="text-xs text-primary-600 font-semibold truncate">{spk.designation}</p>
                        <p className="text-[10px] text-slate-400 font-medium truncate">{spk.institution}</p>
                        {spk.biography && <p className="text-slate-500 text-xs line-clamp-3 pt-1">{spk.biography}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Schedule */}
            {schedule.length > 0 && (
              <section className="space-y-4">
                <h2 className="text-2xl font-bold text-slate-800">Agenda</h2>
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm divide-y divide-slate-100">
                  {schedule.map((item) => (
                    <div key={item.id} className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <h3 className="font-bold text-slate-800 text-sm">{item.title}</h3>
                        <p className="text-xs text-slate-500">{item.description}</p>
                        {item.speaker_name && (
                          <span className="inline-block text-[10px] font-bold bg-primary-50 text-primary-700 px-2 py-0.5 rounded">
                            Host: {item.speaker_name}
                          </span>
                        )}
                      </div>
                      <div className="flex-shrink-0 text-right space-y-1">
                        <span className="text-xs font-bold text-slate-700 block bg-slate-100 px-2.5 py-1 rounded">
                          {item.start_time} - {item.end_time}
                        </span>
                        {item.location && <span className="text-[10px] text-slate-400 block font-medium">📍 {item.location}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

          </div>

          {/* Registration Sidebar Column */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-8 shadow-sm space-y-6 sticky top-24">
              <h2 className="text-xl font-bold text-slate-800 border-b pb-2">Academic Registration</h2>

              {event.status !== 'REGISTRATION_OPEN' ? (
                <div className="bg-slate-100 rounded-lg p-6 text-center text-slate-500 space-y-3">
                  <Calendar className="w-10 h-10 text-slate-400 mx-auto" />
                  <p className="text-sm font-semibold">Registrations Closed</p>
                  <p className="text-xs">This session is currently {event.status.toLowerCase().replace('_', ' ')}.</p>
                </div>
              ) : event.registration_type === 'external' ? (
                <div className="space-y-4">
                  <p className="text-sm text-slate-600 leading-relaxed">
                    This event coordinates external registrations via Google Forms or another university database sheets tool.
                  </p>
                  <a
                    href={event.external_form_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full bg-primary-600 hover:bg-primary-700 text-white text-center py-3.5 rounded-lg font-bold text-sm shadow-sm transition block"
                  >
                    Register via Google Form &rarr;
                  </a>
                  <p className="text-[10px] text-slate-400 leading-normal text-center">
                    Note: Your records will appear in DSMNRU EventHub after the Coordinator completes sheet exports imports.
                  </p>
                </div>
              ) : (
                /* Built-in Register Form */
                <div className="space-y-4">
                  {regError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-xs flex items-center space-x-2">
                      <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                      <span className="font-medium">{regError}</span>
                    </div>
                  )}

                  {regSuccess ? (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center space-y-4">
                      <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
                      <h3 className="font-bold text-green-800 text-lg">Registration Success!</h3>
                      <div className="space-y-2 text-slate-700 text-xs">
                        <p>Welcome! Your entry code has been reserved.</p>
                        <p className="font-mono bg-white border px-3 py-2 rounded font-bold text-slate-800 text-sm">
                          ID: {regSuccess.registrationId}
                        </p>
                      </div>
                      <div className="bg-white border rounded p-4 flex flex-col items-center space-y-2">
                        <span className="text-[10px] text-slate-400 font-bold uppercase">Your Secure Entrance QR Pass</span>
                        <div className="w-32 h-32 bg-slate-100 flex items-center justify-center font-mono text-[9px] text-slate-400 p-2 text-center rounded border border-dashed">
                          QR OPAQUE PASS<br/>[Token Encrypted]<br/>{regSuccess.id.substring(0,8)}...
                        </div>
                        <span className="text-[9px] text-slate-400 text-center leading-normal">Contains opaque identifier token only. Contains absolute zero PII.</span>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={handleRegisterSubmit} className="space-y-4">
                      <div className="space-y-1">
                        <label className="block text-xs font-bold uppercase text-slate-500">Full Name</label>
                        <input
                          type="text"
                          required
                          value={regFullName}
                          onChange={(e) => setRegFullName(e.target.value)}
                          placeholder="e.g. Rahul Sharma"
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="block text-xs font-bold uppercase text-slate-500">College/Univ</label>
                          <input
                            type="text"
                            required
                            value={regCollege}
                            onChange={(e) => setRegCollege(e.target.value)}
                            placeholder="e.g. DSMNRU"
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-xs font-bold uppercase text-slate-500">Department</label>
                          <input
                            type="text"
                            required
                            value={regDept}
                            onChange={(e) => setRegDept(e.target.value)}
                            placeholder="e.g. Computer Science"
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="block text-xs font-bold uppercase text-slate-500">Course</label>
                          <input
                            type="text"
                            required
                            value={regCourse}
                            onChange={(e) => setRegCourse(e.target.value)}
                            placeholder="e.g. B.Tech"
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-xs font-bold uppercase text-slate-500">Year</label>
                          <input
                            type="text"
                            required
                            value={regYear}
                            onChange={(e) => setRegYear(e.target.value)}
                            placeholder="e.g. 3rd"
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="block text-xs font-bold uppercase text-slate-500">Designation</label>
                        <select
                          value={regDesignation}
                          onChange={(e) => setRegDesignation(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
                        >
                          <option value="Student">Student Participant</option>
                          <option value="Faculty">Faculty/Scholar</option>
                          <option value="Speaker">Invited Panelist</option>
                          <option value="Volunteer">Student Volunteer</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="block text-xs font-bold uppercase text-slate-500">Email</label>
                        <input
                          type="email"
                          required
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          placeholder="e.g. rahul@example.com"
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-xs font-bold uppercase text-slate-500">Phone</label>
                        <input
                          type="text"
                          required
                          value={regPhone}
                          onChange={(e) => setRegPhone(e.target.value)}
                          placeholder="e.g. 9876543210"
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={regLoading}
                        className="w-full bg-primary-600 hover:bg-primary-700 text-white py-3 rounded-lg font-bold text-sm shadow-sm transition flex items-center justify-center space-x-2"
                      >
                        {regLoading ? (
                          <RefreshCw className="w-5 h-5 animate-spin" />
                        ) : (
                          <>
                            <UserCheck className="w-5 h-5" />
                            <span>Confirm Registration</span>
                          </>
                        )}
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ==========================================
// PAGE: PUBLIC CERTIFICATE VERIFICATION
// ==========================================
function CertificateVerifyPage() {
  const { certificateId } = useParams<{ certificateId: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!certificateId) return;

    apiRequest<any>(`/certificates/verify/${certificateId}`)
      .then((resData) => {
        setData(resData);
      })
      .catch((err: any) => {
        setError(err.message || 'Failed to request verification server logs');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [certificateId]);

  if (loading) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-4">
        <RefreshCw className="w-10 h-10 text-primary-600 animate-spin mx-auto" />
        <p className="text-slate-600">Querying university certificate validation database...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-xl w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8 space-y-6">
        <div className="text-center space-y-2">
          <span className="text-4xl block">📜</span>
          <h2 className="text-2xl font-extrabold text-slate-800">Cryptographic Verification Status</h2>
          <p className="text-xs text-slate-400 font-mono tracking-wider">ID: {certificateId}</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        {data && (
          <div className="space-y-6">
            {data.verified ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center space-y-4">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto fill-green-50" />
                <h3 className="font-bold text-green-800 text-lg">Authentic DSMNRU Certificate Verified</h3>
                <p className="text-xs text-green-700 leading-normal max-w-sm mx-auto">
                  The digital signature and registry records match completely. This certificate was officially generated and issued by university authorities.
                </p>
                <div className="border-t border-green-200 pt-4 text-left space-y-3 text-xs text-slate-700">
                  <div className="flex justify-between border-b pb-1.5 border-dashed border-green-200">
                    <span className="font-semibold text-slate-500 uppercase tracking-wider">Participant Name</span>
                    <span className="font-bold text-slate-900">{data.participantName}</span>
                  </div>
                  <div className="flex justify-between border-b pb-1.5 border-dashed border-green-200">
                    <span className="font-semibold text-slate-500 uppercase tracking-wider">Event / Activity</span>
                    <span className="font-bold text-slate-900">{data.eventName} ({data.eventShortName})</span>
                  </div>
                  <div className="flex justify-between border-b pb-1.5 border-dashed border-green-200">
                    <span className="font-semibold text-slate-500 uppercase tracking-wider">Department</span>
                    <span className="font-bold text-slate-900">{data.departmentName}</span>
                  </div>
                  <div className="flex justify-between border-b pb-1.5 border-dashed border-green-200">
                    <span className="font-semibold text-slate-500 uppercase tracking-wider">Scope / Role</span>
                    <span className="font-bold text-slate-900 capitalize">{data.certificateType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500 uppercase tracking-wider">Date Issued</span>
                    <span className="font-mono font-bold text-slate-900">{data.issuedAt.split('T')[0]}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center space-y-4">
                <AlertTriangle className="w-12 h-12 text-red-500 mx-auto fill-red-50" />
                <h3 className="font-bold text-red-800 text-lg">Verification Failed</h3>
                <p className="text-xs text-red-700 leading-normal max-w-sm mx-auto">
                  No certificate matching this unique identifier exists in the platform logs. It may be forged, cancelled, or still pending coordinator issue.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="text-center pt-2">
          <Link to="/" className="text-xs font-semibold text-primary-600 hover:text-primary-700">
            &larr; Back to Platform Home Page
          </Link>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// PORTAL ROUTING: DASHBOARD MAIN SHELL
// ==========================================
function Dashboard({ currentUser }: { currentUser: User }) {
  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar Layout */}
      <aside className="w-64 bg-slate-900 text-slate-400 border-r border-slate-800 hidden md:flex flex-col flex-shrink-0">
        <div className="p-6 border-b border-slate-800">
          <h2 className="text-white font-bold text-sm tracking-wider uppercase">Portal Navigation</h2>
          <p className="text-[10px] text-slate-500 mt-1 capitalize">Role: {currentUser.role.replace('_', ' ')}</p>
        </div>
        <div className="flex-grow p-4 space-y-2 text-sm">
          {currentUser.role === 'super_admin' && <AdminMenu />}
          {currentUser.role === 'department_head' && <DeptHeadMenu />}
          {currentUser.role === 'coordinator' && <CoordinatorMenu />}
          {currentUser.role === 'volunteer' && <VolunteerMenu />}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-grow p-8 max-w-7xl mx-auto w-full">
        <Routes>
          <Route path="/" element={<DashboardOverview currentUser={currentUser} />} />
          <Route path="/departments" element={<AdminDepartments />} />
          <Route path="/users" element={<AdminUsers />} />
          <Route path="/health" element={<AdminHealth />} />
          <Route path="/create-event" element={currentUser.role === 'volunteer' ? <ForbiddenNote /> : <CreateEventWizard />} />
          <Route path="/coordinators" element={<DeptCoordinators currentUser={currentUser} />} />
          <Route path="/event-manager/:eventId/*" element={<EventManager currentUser={currentUser} />} />
        </Routes>
      </div>
    </div>
  );
}

function AdminMenu() {
  return (
    <div className="space-y-1">
      <Link to="/dashboard" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-300 transition">
        <Activity className="w-4 h-4 text-primary-400" />
        <span>System Summary</span>
      </Link>
      <Link to="/dashboard/departments" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-300 transition">
        <Building className="w-4 h-4 text-primary-400" />
        <span>Departments</span>
      </Link>
      <Link to="/dashboard/users" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-300 transition">
        <Users className="w-4 h-4 text-primary-400" />
        <span>Coordinator Users</span>
      </Link>
      <Link to="/dashboard/health" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-300 transition">
        <ShieldAlert className="w-4 h-4 text-primary-400" />
        <span>Audit Logs / Health</span>
      </Link>
    </div>
  );
}

function CoordinatorMenu() {
  return (
    <div className="space-y-1">
      <Link to="/dashboard" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-300 transition">
        <Calendar className="w-4 h-4 text-primary-400" />
        <span>Events</span>
      </Link>
      <Link to="/dashboard/create-event" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-300 transition">
        <Plus className="w-4 h-4 text-primary-400" />
        <span>Create Event</span>
      </Link>
    </div>
  );
}

function DeptHeadMenu() {
  return (
    <div className="space-y-1">
      <Link to="/dashboard" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-300 transition">
        <Calendar className="w-4 h-4 text-primary-400" />
        <span>Department Events</span>
      </Link>
      <Link to="/dashboard/create-event" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-300 transition">
        <Plus className="w-4 h-4 text-primary-400" />
        <span>Create Event</span>
      </Link>
      <Link to="/dashboard/coordinators" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-300 transition">
        <Users className="w-4 h-4 text-primary-400" />
        <span>Coordinators</span>
      </Link>
    </div>
  );
}

function VolunteerMenu() {
  return (
    <div className="space-y-1">
      <Link to="/dashboard" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-300 transition">
        <QrCode className="w-4 h-4 text-primary-400" />
        <span>My Events / Scanner</span>
      </Link>
    </div>
  );
}

function ForbiddenNote() {
  return <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700 text-sm font-semibold">403 — Volunteers cannot create events.</div>;
}

function DeptCoordinators({ currentUser }: { currentUser: User }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [list, setList] = useState<any[]>([]);

  const load = () => {
    apiRequest<any[]>('/staff/coordinators').then((d) => setList(d || [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  if (currentUser.role !== 'department_head' && currentUser.role !== 'super_admin') {
    return <ForbiddenNote />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-800">Coordinators</h1>
      <form
        className="bg-white border rounded-xl p-6 space-y-3 max-w-lg"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await apiRequest<any>('/staff/coordinators', { method: 'POST', body: JSON.stringify({ email, full_name: fullName }) });
          setToken(res.setup_token);
          setEmail('');
          setFullName('');
          load();
        }}
      >
        <input className="w-full border rounded px-3 py-2 text-sm" placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        <input className="w-full border rounded px-3 py-2 text-sm" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <button className="bg-primary-600 text-white text-xs font-bold px-4 py-2 rounded">Create coordinator</button>
        {token && <p className="text-xs text-slate-600">Setup link: /setup-password?token={token}</p>}
      </form>
      <ul className="text-sm space-y-2">
        {list.map((u) => <li key={u.id} className="bg-white border rounded p-3">{u.full_name} — {u.email} ({u.status})</li>)}
      </ul>
    </div>
  );
}

// ==========================================
// SUB-PAGE: DASHBOARD PORTAL OVERVIEW
// ==========================================
function DashboardOverview({ currentUser }: { currentUser: User }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // List events that are visible or managed by this user
    apiRequest<{ events: Event[] }>('/events')
      .then((data) => {
        setEvents(data.events || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-800">Welcome back, {currentUser.full_name}!</h1>
        <p className="text-slate-500">Coordinate and manage DSMNRU events from your secure workspace.</p>
      </div>

      {currentUser.role === 'super_admin' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-2">
            <Building className="w-8 h-8 text-primary-600" />
            <h3 className="font-bold text-slate-800 text-sm">Departments Admin</h3>
            <p className="text-xs text-slate-500">Configure academic departments, codes, and headers.</p>
            <Link to="/dashboard/departments" className="text-xs font-bold text-primary-600 inline-block pt-2">Configure Departments &rarr;</Link>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-2">
            <Users className="w-8 h-8 text-primary-600" />
            <h3 className="font-bold text-slate-800 text-sm">Users Approval</h3>
            <p className="text-xs text-slate-500">Approve pending department coordinator registration requests.</p>
            <Link to="/dashboard/users" className="text-xs font-bold text-primary-600 inline-block pt-2">Review Requests &rarr;</Link>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-2">
            <ShieldAlert className="w-8 h-8 text-primary-600" />
            <h3 className="font-bold text-slate-800 text-sm">Health Observatory</h3>
            <p className="text-xs text-slate-500">Audit system events logs and trace API latencies.</p>
            <Link to="/dashboard/health" className="text-xs font-bold text-primary-600 inline-block pt-2">Open Logs &rarr;</Link>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex justify-between items-center border-b pb-4">
            <h2 className="text-xl font-bold text-slate-800">Managed Academic Events</h2>
            {currentUser.role !== 'volunteer' && (
            <Link to="/dashboard/create-event" className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition flex items-center space-x-1.5">
              <Plus className="w-4 h-4" />
              <span>Create Event Wizard</span>
            </Link>
            )}
          </div>

          {loading ? (
            <div className="py-12 text-center">
              <RefreshCw className="w-8 h-8 text-primary-600 animate-spin mx-auto mb-2" />
              <p className="text-xs text-slate-500">Loading events directory...</p>
            </div>
          ) : events.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-12 text-center max-w-lg mx-auto">
              <Calendar className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <h3 className="font-bold text-slate-700 text-lg">No Managed Events</h3>
              <p className="text-slate-500 text-sm mt-1">You are not coordinating any active events currently. Use the Wizard to build your first event!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {events.map((evt) => (
                <div key={evt.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-sm transition flex flex-col justify-between p-6 space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] uppercase font-bold text-primary-600 bg-primary-50 px-2.5 py-1 rounded">
                        {evt.event_type}
                      </span>
                      <span className="text-[9px] uppercase font-extrabold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                        {evt.status}
                      </span>
                    </div>
                    <h3 className="font-extrabold text-lg text-slate-800 leading-tight">
                      {evt.name}
                    </h3>
                    <p className="text-xs text-slate-500">Venue: {evt.venue}</p>
                  </div>
                  <div className="border-t pt-4 flex justify-between items-center">
                    <span className="text-[10px] font-mono text-slate-400">ID: {evt.id.substring(0,8)}...</span>
                    <Link to={`/dashboard/event-manager/${evt.id}`} className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-3 py-1.5 rounded transition">
                      Manage &rarr;
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==========================================
// SUB-PAGE: SUPER ADMIN - DEPARTMENTS
// ==========================================
function AdminDepartments() {
  const [depts, setDepts] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [desc, setDesc] = useState('');

  const fetchDepts = () => {
    setLoading(true);
    apiRequest<Department[]>('/departments')
      .then((data) => setDepts(data || []))
      .catch((err) => alert(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchDepts();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !code) return;

    try {
      await apiRequest('/departments', {
        method: 'POST',
        body: JSON.stringify({ name, code, description: desc })
      });
      setName('');
      setCode('');
      setDesc('');
      fetchDepts();
    } catch (err: any) {
      alert(err.message || 'Failed to create department');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this department? All events associated will be affected.')) return;
    try {
      await apiRequest(`/departments/${id}`, { method: 'DELETE' });
      fetchDepts();
    } catch (err: any) {
      alert(err.message || 'Failed to delete department');
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-800">Departments Directory</h1>
        <p className="text-slate-500">Configure academic faculties, departments, and metadata records.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Create Department Box */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4 h-fit">
          <h2 className="text-lg font-bold text-slate-800 border-b pb-2">Add Department</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase text-slate-500">Department Title</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Computer Science & Eng"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase text-slate-500">Short Code</label>
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. CS"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase text-slate-500">Description</label>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Faculty details..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
              />
            </div>
            <button type="submit" className="w-full bg-primary-600 hover:bg-primary-700 text-white py-2.5 rounded-lg font-bold text-xs shadow-sm transition">
              Create Record
            </button>
          </form>
        </div>

        {/* Directory Listing */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          {loading ? (
            <div className="py-12 text-center">
              <RefreshCw className="w-8 h-8 text-primary-600 animate-spin mx-auto mb-2" />
              <p className="text-xs text-slate-500">Gathering departments ledger...</p>
            </div>
          ) : depts.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <Building className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-semibold">No Departments Found</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-xs tracking-wider">
                  <th className="p-4">Short Code</th>
                  <th className="p-4">Department Name</th>
                  <th className="p-4">Description</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {depts.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50 transition">
                    <td className="p-4 font-mono font-bold text-slate-900">{d.code}</td>
                    <td className="p-4 font-semibold">{d.name}</td>
                    <td className="p-4 text-xs text-slate-500 line-clamp-2">{d.description || 'N/A'}</td>
                    <td className="p-4 text-right">
                      <button onClick={() => handleDelete(d.id)} className="text-red-500 hover:text-red-700 p-1.5 transition">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}

// ==========================================
// SUB-PAGE: SUPER ADMIN - USERS APPROVAL
// ==========================================
function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [dhName, setDhName] = useState('');
  const [dhEmail, setDhEmail] = useState('');
  const [dhDept, setDhDept] = useState('');
  const [depts, setDepts] = useState<Department[]>([]);
  const [setupTok, setSetupTok] = useState<string | null>(null);

  const fetchUsers = () => {
    setLoading(true);
    apiRequest<{ users: User[] }>('/admin/users')
      .then((data) => setUsers(data.users || []))
      .catch((err) => alert(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleStatusChange = async (userId: string, status: string) => {
    try {
      await apiRequest(`/admin/users/${userId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status })
      });
      fetchUsers();
    } catch (err: any) {
      alert(err.message || 'Status update failed');
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await apiRequest(`/admin/users/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role })
      });
      fetchUsers();
    } catch (err: any) {
      alert(err.message || 'Role change failed');
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-800">Coordinator Directory</h1>
        <p className="text-slate-500">Provision Department Heads. Staff cannot self-register into privileged roles.</p>
      </div>

      <form
        className="bg-white border rounded-xl p-6 grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await apiRequest<any>('/staff/department-heads', {
            method: 'POST',
            body: JSON.stringify({ email: dhEmail, full_name: dhName, department_id: dhDept })
          });
          setSetupTok(res.setup_token);
          setDhName('');
          setDhEmail('');
          fetchUsers();
        }}
      >
        <input className="border rounded px-3 py-2 text-sm" placeholder="Head name" value={dhName} onChange={(e) => setDhName(e.target.value)} required />
        <input className="border rounded px-3 py-2 text-sm" placeholder="Email" type="email" value={dhEmail} onChange={(e) => setDhEmail(e.target.value)} required />
        <select className="border rounded px-3 py-2 text-sm" value={dhDept} onChange={(e) => setDhDept(e.target.value)}>
          {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button className="bg-primary-600 text-white text-xs font-bold px-4 py-2 rounded">Create Department Head</button>
        {setupTok && <p className="md:col-span-4 text-xs">Setup: /setup-password?token={setupTok}</p>}
      </form>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="py-12 text-center">
            <RefreshCw className="w-8 h-8 text-primary-600 animate-spin mx-auto mb-2" />
            <p className="text-xs text-slate-500">Checking registry accounts...</p>
          </div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold">No Coordinators Registered</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-xs tracking-wider">
                <th className="p-4">Coordinator Details</th>
                <th className="p-4">System Role</th>
                <th className="p-4">Account Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50 transition">
                  <td className="p-4">
                    <div className="space-y-0.5">
                      <p className="font-bold text-slate-900">{u.full_name}</p>
                      <p className="text-xs text-slate-500">{u.email}</p>
                      {u.phone && <p className="text-[10px] text-slate-400">Phone: {u.phone}</p>}
                    </div>
                  </td>
                  <td className="p-4">
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      className="px-2.5 py-1.5 border border-slate-300 rounded text-xs text-slate-700 font-medium focus:ring-1 focus:ring-primary-500 focus:outline-none"
                    >
                      <option value="coordinator">Event Coordinator</option>
                      <option value="department_head">Department Head</option>
                      <option value="volunteer">Volunteer Scanner</option>
                      <option value="super_admin">Super Admin</option>
                    </select>
                  </td>
                  <td className="p-4">
                    <span className={`inline-block px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wide ${
                      u.status === 'active' ? 'bg-green-50 text-green-700' :
                      u.status === 'pending' ? 'bg-amber-50 text-amber-700 animate-pulse' :
                      'bg-red-50 text-red-700'
                    }`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="p-4 text-right space-x-1.5">
                    {u.status === 'pending' && (
                      <button
                        onClick={() => handleStatusChange(u.id, 'active')}
                        className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-3 py-1.5 rounded transition"
                      >
                        Approve
                      </button>
                    )}
                    {u.status === 'active' ? (
                      <button
                        onClick={() => handleStatusChange(u.id, 'suspended')}
                        className="bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold px-3 py-1.5 rounded transition border border-red-200"
                      >
                        Suspend
                      </button>
                    ) : u.status === 'suspended' ? (
                      <button
                        onClick={() => handleStatusChange(u.id, 'active')}
                        className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-3 py-1.5 rounded transition"
                      >
                        Reactivate
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ==========================================
// SUB-PAGE: SUPER ADMIN - HEALTH & AUDIT LOGS
// ==========================================
function AdminHealth() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchHealth = () => {
    setLoading(true);
    apiRequest<any>('/admin/health')
      .then((healthData) => setData(healthData))
      .catch((err) => alert(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end border-b pb-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-800">System Observability</h1>
          <p className="text-slate-500">Live system health checks, database latency telemetry, and audit trail.</p>
        </div>
        <button onClick={fetchHealth} className="bg-white border hover:bg-slate-50 text-slate-700 text-xs font-bold px-3.5 py-2 rounded-lg flex items-center space-x-1 shadow-sm transition">
          <RefreshCw className="w-4.5 h-4.5" />
          <span>Refresh metrics</span>
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center">
          <RefreshCw className="w-10 h-10 text-primary-600 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">Querying platform logs...</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Health Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-1">
              <span className="text-xs uppercase font-bold text-slate-400">Database Connection</span>
              <p className="text-lg font-bold text-green-600 flex items-center">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 mr-2"></span>
                Healthy
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-1">
              <span className="text-xs uppercase font-bold text-slate-400">DB Latency</span>
              <p className="text-lg font-bold text-slate-800">{data?.database?.latencyMs || 0}ms</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-1">
              <span className="text-xs uppercase font-bold text-slate-400">Total Events Hosted</span>
              <p className="text-lg font-bold text-slate-800">{data?.stats?.total_events || 0}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-1">
              <span className="text-xs uppercase font-bold text-slate-400">Total System Users</span>
              <p className="text-lg font-bold text-slate-800">{data?.stats?.total_users || 0}</p>
            </div>
          </div>

          {/* Audit Logs */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-slate-800">Security Audit Logs Ledger</h2>
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="p-4">Timestamp</th>
                    <th className="p-4">Uploader/User</th>
                    <th className="p-4">Action Event</th>
                    <th className="p-4">Target Scope</th>
                    <th className="p-4">Audit Metadata Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-600 font-medium">
                  {data?.recentLogs?.map((log: AuditLog) => (
                    <tr key={log.id} className="hover:bg-slate-50 transition">
                      <td className="p-4 font-mono text-slate-400 text-[10px]">{new Date(log.timestamp).toLocaleString()}</td>
                      <td className="p-4 font-semibold text-slate-800">{log.user_email || 'System / Participant'}</td>
                      <td className="p-4"><span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-mono font-bold">{log.action}</span></td>
                      <td className="p-4 capitalize">{log.target_type}</td>
                      <td className="p-4 font-mono text-[10px] max-w-sm truncate" title={log.details}>{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// PORTAL ROUTING: MULTI-STEP CREATOR WIZARD
// ==========================================
function CreateEventWizard() {
  const [step, setStep] = useState(1);
  const [depts, setDepts] = useState<Department[]>([]);

  // Wizard Data State
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [type, setType] = useState('workshop');
  const [deptId, setDeptId] = useState('');
  const [theme, setTheme] = useState('');
  const [desc, setDesc] = useState('');
  
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [venue, setVenue] = useState('');
  const [format, setFormat] = useState<'online' | 'offline' | 'hybrid'>('offline');
  const [meetingLink, setMeetingLink] = useState('');

  const [regType, setRegType] = useState<'built_in' | 'external'>('built_in');
  const [extFormUrl, setExtFormUrl] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();

  useEffect(() => {
    apiRequest<Department[]>('/departments')
      .then((data) => {
        setDepts(data || []);
        if (data.length > 0) setDeptId(data[0].id);
      })
      .catch(() => {});
  }, []);

  const handleFinish = async () => {
    setLoading(true);
    setError(null);

    const payload = {
      name,
      short_name: shortName,
      event_type: type,
      department_id: deptId,
      theme,
      description: desc,
      start_date: startDate,
      end_date: endDate,
      start_time: startTime,
      end_time: endTime,
      venue,
      format,
      meeting_link: meetingLink,
      registration_type: regType,
      external_form_url: extFormUrl
    };

    try {
      const result = await apiRequest<{ id: string }>('/events', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      navigate(`/dashboard/event-manager/${result.id}`);
    } catch (err: any) {
      setError(err.message || 'Event creation failed. Please verify dates and inputs.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-2xl shadow-sm p-8 space-y-6">
      <div className="border-b pb-4 space-y-2">
        <h1 className="text-2xl font-extrabold text-slate-800">Create Academic Event Wizard</h1>
        <div className="flex items-center space-x-2 text-xs font-semibold text-slate-400">
          <span className={step === 1 ? 'text-primary-600 font-bold' : ''}>1. Basic Details</span>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className={step === 2 ? 'text-primary-600 font-bold' : ''}>2. Date & Venue</span>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className={step === 3 ? 'text-primary-600 font-bold' : ''}>3. Registration</span>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm flex items-center space-x-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Step 1: Basic Information */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase text-slate-500">Event Title</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. National Symposium on Web Technologies"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase text-slate-500">Event Short Name (Acronym)</label>
              <input
                type="text"
                required
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
                placeholder="e.g. NSWT-2026"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase text-slate-500">Event Category / Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
              >
                <option value="conference">Conference</option>
                <option value="seminar">Seminar</option>
                <option value="workshop">Workshop</option>
                <option value="symposium">Symposium</option>
                <option value="fdp">Faculty Development Prog (FDP)</option>
                <option value="webinar">Webinar</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-500">Department is assigned by the server from your membership. Super Admin may pick a department.</p>
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase text-slate-500">Department (Super Admin only)</label>
            <select
              value={deptId}
              onChange={(e) => setDeptId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
            >
              {depts.map((d) => (
                <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase text-slate-500">Academic Theme (Optional)</label>
            <input
              type="text"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="e.g. Advancements in Machine Learning and cloud structures."
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase text-slate-500">Description</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Provide a comprehensive academic description, schedule guidelines, session eligibility..."
              rows={4}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
            />
          </div>
          <div className="pt-4 flex justify-end">
            <button
              onClick={() => {
                if (!name || !shortName) {
                  setError('Title and Short Acronym are required to progress.');
                  return;
                }
                setError(null);
                setStep(2);
              }}
              className="bg-primary-600 hover:bg-primary-700 text-white px-5 py-2 rounded-lg font-bold text-xs shadow-sm transition"
            >
              Next Step: Schedule Details &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Date & Venue */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase text-slate-500">Start Date</label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase text-slate-500">End Date</label>
              <input
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase text-slate-500">Start Time (HH:MM)</label>
              <input
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase text-slate-500">End Time (HH:MM)</label>
              <input
                type="time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase text-slate-500">Event Format</label>
              <select
                value={format}
                onChange={(e: any) => setFormat(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
              >
                <option value="offline">Offline / In-Person</option>
                <option value="online">Online / Webinar</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase text-slate-500">Venue Location / Room</label>
              <input
                type="text"
                required
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="e.g. Auditorium Room 102 / Zoom"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
              />
            </div>
          </div>
          {(format === 'online' || format === 'hybrid') && (
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase text-slate-500">Online Meeting URL Link</label>
              <input
                type="url"
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                placeholder="https://zoom.us/j/..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
              />
            </div>
          )}
          <div className="pt-4 flex justify-between">
            <button onClick={() => setStep(1)} className="text-slate-500 hover:text-slate-800 font-semibold text-xs transition">
              &larr; Back to Basics
            </button>
            <button
              onClick={() => {
                if (!startDate || !endDate || !startTime || !endTime || !venue) {
                  setError('All schedule and venue inputs must be complete.');
                  return;
                }
                setError(null);
                setStep(3);
              }}
              className="bg-primary-600 hover:bg-primary-700 text-white px-5 py-2 rounded-lg font-bold text-xs shadow-sm transition"
            >
              Next Step: Registration Portal &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Registration Mode */}
      {step === 3 && (
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase text-slate-500">Registration Mode</label>
            <div className="grid grid-cols-2 gap-4">
              <label className={`border rounded-xl p-4 flex items-start space-x-3 cursor-pointer transition hover:bg-slate-50 ${
                regType === 'built_in' ? 'border-primary-500 ring-1 ring-primary-500 bg-primary-50/20' : 'border-slate-200'
              }`}>
                <input
                  type="radio"
                  name="regType"
                  value="built_in"
                  checked={regType === 'built_in'}
                  onChange={() => setRegType('built_in')}
                  className="mt-1"
                />
                <div className="text-xs">
                  <p className="font-bold text-slate-800">Built-In Registration</p>
                  <p className="text-slate-500 mt-1">Participants register directly on DSMNRU EventHub.</p>
                </div>
              </label>
              <label className={`border rounded-xl p-4 flex items-start space-x-3 cursor-pointer transition hover:bg-slate-50 ${
                regType === 'external' ? 'border-primary-500 ring-1 ring-primary-500 bg-primary-50/20' : 'border-slate-200'
              }`}>
                <input
                  type="radio"
                  name="regType"
                  value="external"
                  checked={regType === 'external'}
                  onChange={() => setRegType('external')}
                  className="mt-1"
                />
                <div className="text-xs">
                  <p className="font-bold text-slate-800">External CSV / Google Form</p>
                  <p className="text-slate-500 mt-1">Provide external URL. Coordinator manually imports CSV sheets.</p>
                </div>
              </label>
            </div>
          </div>

          {regType === 'external' && (
            <div className="space-y-1 animate-fade-in">
              <label className="block text-xs font-bold uppercase text-slate-500">Google Form URL Link</label>
              <input
                type="url"
                required
                value={extFormUrl}
                onChange={(e) => setExtFormUrl(e.target.value)}
                placeholder="https://docs.google.com/forms/..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-sm"
              />
            </div>
          )}

          <div className="pt-4 border-t flex justify-between items-center">
            <button onClick={() => setStep(2)} className="text-slate-500 hover:text-slate-800 font-semibold text-xs transition">
              &larr; Back to Venue
            </button>
            <button
              onClick={handleFinish}
              disabled={loading}
              className="bg-green-600 hover:bg-green-700 text-white px-6 py-2.5 rounded-lg font-bold text-xs shadow-sm transition flex items-center space-x-1.5"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <CheckCircle className="w-4.5 h-4.5" />
                  <span>Build Event Dashboard</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// CENTRAL MANAGER: EVENT COORDINATOR TABS
// ==========================================
function EventManager({ currentUser }: { currentUser: User }) {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  const fetchEventDetails = () => {
    if (!eventId) return;
    setLoading(true);
    apiRequest<Event>(`/events/${eventId}`)
      .then((data) => setEvent(data))
      .catch((err) => alert(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchEventDetails();
  }, [eventId]);

  const handleStatusTransition = async (nextStatus: string) => {
    if (!event) return;
    if (!confirm(`Are you sure you want to transition the event status to ${nextStatus}?`)) return;

    try {
      await apiRequest(`/events/${event.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus })
      });
      fetchEventDetails();
    } catch (err: any) {
      alert(err.message || 'State transition rejected by server.');
    }
  };

  const handleDuplicateEvent = async () => {
    if (!event) return;
    if (!confirm('Would you like to duplicate this event structure (agenda, panel, custom fields, and certificate settings) into a new Draft?')) return;

    try {
      const res = await apiRequest<any>(`/events/${event.id}/duplicate`, { method: 'POST' });
      alert(`Event duplicated! New Draft ID: ${res.id}`);
      window.location.href = `/dashboard/event-manager/${res.id}`;
    } catch (err: any) {
      alert(err.message || 'Duplication failed');
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center">
        <RefreshCw className="w-10 h-10 text-primary-600 animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-500 font-medium">Connecting to event ledger...</p>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center max-w-lg mx-auto space-y-3">
        <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
        <h3 className="font-bold text-red-800">Event Ledger Missing</h3>
        <p className="text-slate-500 text-xs">No active event coordinates exist matching this registration.</p>
      </div>
    );
  }

  const tabList = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'registrations', label: 'Registrations', icon: Users },
    { id: 'import', label: 'CSV Import Sheets', icon: Upload },
    { id: 'agenda', label: 'Agenda / Schedule', icon: Calendar },
    { id: 'panel', label: 'Panelist Speakers', icon: Briefcase },
    { id: 'bulletins', label: 'Bulletins / Alerts', icon: Mail },
    { id: 'scanners', label: 'Real-Time Scanners', icon: QrCode },
    { id: 'volunteers', label: 'Volunteers', icon: UserPlus },
    { id: 'certificates', label: 'Certificates bulk', icon: FileText },
    { id: 'campaigns', label: 'Email Analytics', icon: Mail }
  ].filter((tab) => currentUser.role !== 'volunteer' || tab.id === 'scanners');

  return (
    <div className="space-y-8">
      {/* Event Header Panel */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-2">
          <div className="flex items-center space-x-3">
            <span className="text-xs uppercase font-extrabold bg-primary-100 text-primary-700 px-2.5 py-1 rounded">
              {event.event_type}
            </span>
            <span className="text-xs uppercase font-extrabold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
              {event.status}
            </span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-800 leading-tight">{event.name}</h1>
          <p className="text-xs text-slate-400 font-medium">Acronym: {event.short_name} | ID: <code>{event.id}</code></p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {event.status === 'DRAFT' && (
            <button onClick={() => handleStatusTransition('PUBLISHED')} className="bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold px-4 py-2 rounded-lg shadow-sm transition">
              Publish Page
            </button>
          )}
          {event.status === 'PUBLISHED' && (
            <button onClick={() => handleStatusTransition('REGISTRATION_OPEN')} className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-4 py-2 rounded-lg shadow-sm transition">
              Open Registration
            </button>
          )}
          {event.status === 'REGISTRATION_OPEN' && (
            <button onClick={() => handleStatusTransition('REGISTRATION_CLOSED')} className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-lg shadow-sm transition">
              Close Registration
            </button>
          )}
          {event.status === 'REGISTRATION_CLOSED' && (
            <button onClick={() => handleStatusTransition('ONGOING')} className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-4 py-2 rounded-lg shadow-sm transition">
              Set Ongoing
            </button>
          )}
          {event.status === 'ONGOING' && (
            <button onClick={() => handleStatusTransition('COMPLETED')} className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-lg shadow-sm transition">
              Complete Event
            </button>
          )}
          {event.status === 'COMPLETED' && (
            <button onClick={() => handleStatusTransition('ARCHIVED')} className="bg-slate-400 hover:bg-slate-500 text-white text-xs font-bold px-4 py-2 rounded-lg shadow-sm transition">
              Archive Event
            </button>
          )}
          <button onClick={handleDuplicateEvent} className="bg-white border hover:bg-slate-50 text-slate-700 text-xs font-bold px-4 py-2 rounded-lg shadow-sm flex items-center space-x-1.5 transition">
            <Copy className="w-3.5 h-3.5" />
            <span>Duplicate Structure</span>
          </button>
        </div>
      </div>

      {/* Lazy-loaded Navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {tabList.map((tab) => {
          const Icon = tab.icon;
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-2 px-4 py-2.5 rounded-lg text-xs font-bold transition ${
                isSelected
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Render selected manager tab content */}
      <div className="mt-4">
        {activeTab === 'overview' && <EventTabOverview event={event} />}
        {activeTab === 'registrations' && <EventTabRegistrations event={event} />}
        {activeTab === 'import' && <EventTabImport event={event} />}
        {activeTab === 'agenda' && <EventTabAgenda event={event} />}
        {activeTab === 'panel' && <EventTabPanel event={event} />}
        {activeTab === 'bulletins' && <EventTabBulletins event={event} />}
        {activeTab === 'scanners' && <EventTabScanners event={event} />}
        {activeTab === 'volunteers' && currentUser.role !== 'volunteer' && <EventTabVolunteers event={event} />}
        {activeTab === 'certificates' && currentUser.role !== 'volunteer' && <EventTabCertificates event={event} />}
        {activeTab === 'campaigns' && <EventTabCampaigns event={event} />}
      </div>
    </div>
  );
}

// ==========================================
// EVENT TAB: OVERVIEW STATS
// ==========================================
function EventTabOverview({ event }: { event: Event }) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<any>(`/operations/events/${event.id}/dashboard`)
      .then((data) => setStats(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [event.id]);

  if (loading) {
    return (
      <div className="py-12 text-center">
        <RefreshCw className="w-8 h-8 text-primary-600 animate-spin mx-auto mb-2" />
        <p className="text-xs text-slate-500 font-medium">Gathering analytics ledger...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Analytical Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-2">
          <span className="text-xs uppercase font-bold text-slate-400">Total Registered</span>
          <p className="text-3xl font-extrabold text-slate-800">{stats?.registered || 0}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-2">
          <span className="text-xs uppercase font-bold text-slate-400">Marked Attendance</span>
          <p className="text-3xl font-extrabold text-green-600">{stats?.attended || 0}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-2">
          <span className="text-xs uppercase font-bold text-slate-400">Absent Participants</span>
          <p className="text-3xl font-extrabold text-amber-600">{stats?.absent || 0}</p>
        </div>
      </div>

      {/* Details Box */}
      <div className="bg-white border border-slate-200 rounded-xl p-8 shadow-sm space-y-6">
        <h2 className="text-xl font-bold text-slate-800 border-b pb-2">Academic Page Link</h2>
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <input
            type="text"
            readOnly
            value={`${window.location.origin}/events/${event.slug}`}
            className="bg-slate-50 px-4 py-2.5 rounded-lg border border-slate-300 font-mono text-xs flex-grow focus:outline-none"
          />
          <button
            onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}/events/${event.slug}`);
              alert('Copied academic event URL to clipboard!');
            }}
            className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-5 py-2.5 rounded-lg flex items-center justify-center space-x-1 shadow-sm transition"
          >
            <Copy className="w-4.5 h-4.5" />
            <span>Copy Link</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// EVENT TAB: REGISTRATIONS MANAGEMENT
// ==========================================
function EventTabRegistrations({ event }: { event: Event }) {
  const [regs, setRegs] = useState<Participant[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchRegistrations = () => {
    setLoading(true);
    apiRequest<any>(`/registrations/events/${event.id}/registrations?page=${page}&limit=20&search=${search}`)
      .then((data) => {
        setRegs(data.registrations || []);
        setTotalPages(data.pagination.totalPages || 1);
      })
      .catch((err) => alert(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchRegistrations();
  }, [event.id, page, search]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this participant? All attendance and certificate issues associated will be cancelled.')) return;

    try {
      await apiRequest(`/registrations/events/${event.id}/registrations/${id}`, { method: 'DELETE' });
      fetchRegistrations();
    } catch (err: any) {
      alert(err.message || 'Deletion failed');
    }
  };

  const handleExport = () => {
    window.open(`/api/v1/registrations/events/${event.id}/registrations/export`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4">
        {/* Search Input */}
        <div className="relative flex-grow max-w-md">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
            <Search className="w-4.5 h-4.5" />
          </span>
          <input
            type="text"
            placeholder="Search by name, email, college, registration ID..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs shadow-sm"
          />
        </div>
        <button
          onClick={handleExport}
          className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2.5 rounded-lg shadow-sm flex items-center justify-center space-x-1.5 transition"
        >
          <Download className="w-4 h-4" />
          <span>Export Excel/CSV</span>
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="py-12 text-center">
            <RefreshCw className="w-8 h-8 text-primary-600 animate-spin mx-auto mb-2" />
            <p className="text-xs text-slate-500 font-medium">Gathering participants directory...</p>
          </div>
        ) : regs.length === 0 ? (
          <div className="p-12 text-center text-slate-500 space-y-2">
            <Users className="w-12 h-12 text-slate-300 mx-auto" />
            <p className="text-sm font-semibold">No Registrations Located</p>
            <p className="text-xs">There are no participants registered or matched under your query.</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                <th className="p-4">Reg ID</th>
                <th className="p-4">Participant Details</th>
                <th className="p-4">Faculty / Course</th>
                <th className="p-4">Registered Date</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {regs.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 transition">
                  <td className="p-4 font-mono font-bold text-slate-900">{r.registration_id}</td>
                  <td className="p-4">
                    <div className="space-y-0.5">
                      <p className="font-bold text-slate-800">{r.full_name}</p>
                      <p className="text-[10px] text-slate-400">{r.email}</p>
                      <p className="text-[10px] text-slate-400">Phone: {r.phone}</p>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="space-y-0.5">
                      <p className="font-semibold">{r.college}</p>
                      <p className="text-[10px] text-slate-500 capitalize">{r.designation} • {r.course} • Yr {r.year}</p>
                    </div>
                  </td>
                  <td className="p-4 text-slate-400">{r.created_at.split('T')[0]}</td>
                  <td className="p-4 text-right">
                    <button onClick={() => handleDelete(r.id)} className="text-red-500 hover:text-red-700 p-1.5 transition">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center space-x-3 text-xs font-semibold text-slate-500">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 disabled:opacity-50 transition"
          >
            Prev
          </button>
          <span>Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 disabled:opacity-50 transition"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// Helper to parse RFC-4180 CSV safely client-side
function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      row.push(cell.trim());
      if (row.length > 1 || row[0] !== '') {
        lines.push(row);
      }
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell.trim());
    lines.push(row);
  }

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = lines[0];
  const rows = lines.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] || '';
    });
    return obj;
  });

  return { headers, rows };
}

// ==========================================
// EVENT TAB: CSV REPEATED IMPORTS SHEET PORTAL
// ==========================================
function EventTabImport({ event }: { event: Event }) {
  const [csvText, setCsvText] = useState('');
  const [filename, setFilename] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({
    full_name: '',
    email: '',
    phone: '',
    college: '',
    department: '',
    course: '',
    year: '',
    designation: ''
  });

  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [success, setSuccess] = useState<any>(null);

  const getMappedParticipants = () => {
    const { rows } = parseCSV(csvText);
    return rows.map((row) => {
      return {
        full_name: row[mapping.full_name] || '',
        email: row[mapping.email] || '',
        phone: row[mapping.phone] || '',
        college: row[mapping.college] || '',
        department: row[mapping.department] || '',
        course: row[mapping.course] || '',
        year: row[mapping.year] || '',
        designation: row[mapping.designation] || 'Student'
      };
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFilename(file.name);
    setError(null);
    setPreview(null);
    setSuccess(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setCsvText(text);

      // Parse headers with client-side RFC-4180 parser
      const { headers: cols } = parseCSV(text);
      if (cols.length > 0) {
        setHeaders(cols);

        // Intelligently auto-map standard headers
        const newMap = { ...mapping };
        const mappingKeys = Object.keys(mapping);
        for (const col of cols) {
          const lower = col.toLowerCase();
          for (const key of mappingKeys) {
            if (
              lower.includes(key) ||
              (key === 'full_name' && (lower.includes('name') || lower.includes('student'))) ||
              (key === 'college' && (lower.includes('university') || lower.includes('institute')))
            ) {
              newMap[key] = col;
            }
          }
        }
        setMapping(newMap);
      }
    };
    reader.readAsText(file);
  };

  const handlePreviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvText) return;

    setLoading(true);
    setError(null);
    setPreview(null);
    setSuccess(null);

    try {
      const participants = getMappedParticipants();
      if (participants.length > 1000) {
        throw new Error('Spreadsheet exceeds maximum limit of 1000 rows. Please split into smaller batches.');
      }
      const data = await apiRequest<any>(`/registrations/events/${event.id}/registrations/import-preview`, {
        method: 'POST',
        body: JSON.stringify({ participants })
      });
      setPreview(data);
    } catch (err: any) {
      setError(err.message || 'Failed to analyze import preview.');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyCommit = async () => {
    if (!preview) return;
    setLoading(true);
    setError(null);

    try {
      const participants = getMappedParticipants();
      const data = await apiRequest<any>(`/registrations/events/${event.id}/registrations/import-commit`, {
        method: 'POST',
        body: JSON.stringify({ participants, filename })
      });
      setSuccess(data);
      setPreview(null);
      setCsvText('');
      setFilename('');
    } catch (err: any) {
      setError(err.message || 'Failed to apply import transaction.');
    } finally {
      setLoading(false);
    }
  };

  const requiredFields = ['full_name', 'email', 'phone', 'college', 'department', 'course', 'year', 'designation'];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-8 shadow-sm space-y-8">
      <div>
        <h2 className="text-xl font-bold text-slate-800 border-b pb-2">CSV Sheets Repeated Import Portal</h2>
        <p className="text-xs text-slate-500 mt-1">
          Import sheets from external registration engines. You can upload updated sheet spreadsheets multiple times safely.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-xs flex items-center space-x-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center space-y-4">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
          <h3 className="font-bold text-green-800 text-lg">CSV Sheets Applied Safely!</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-slate-700 text-xs max-w-xl mx-auto border-t pt-4 border-dashed border-green-200">
            <div>
              <p className="text-slate-400 font-bold uppercase text-[9px]">Total Rows</p>
              <p className="font-bold text-lg text-slate-800">{success.totalProcessed}</p>
            </div>
            <div>
              <p className="text-slate-400 font-bold uppercase text-[9px]">Inserted New</p>
              <p className="font-bold text-lg text-green-600">{success.inserted}</p>
            </div>
            <div>
              <p className="text-slate-400 font-bold uppercase text-[9px]">Updated Details</p>
              <p className="font-bold text-lg text-primary-600">{success.updated}</p>
            </div>
            <div>
              <p className="text-slate-400 font-bold uppercase text-[9px]">Ignored Duplicates</p>
              <p className="font-bold text-lg text-slate-500">{success.duplicates}</p>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handlePreviewSubmit} className="space-y-6">
        <div className="border border-dashed border-slate-300 rounded-xl p-8 text-center bg-slate-50 relative hover:bg-slate-100 transition cursor-pointer flex flex-col items-center">
          <input
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
          <Upload className="w-10 h-10 text-slate-400 mb-3" />
          {filename ? (
            <div className="space-y-1">
              <p className="font-bold text-slate-800 text-sm">{filename}</p>
              <p className="text-xs text-slate-400 font-medium">Ready to map columns</p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="font-bold text-slate-800 text-sm">Upload Spreadsheet Sheet</p>
              <p className="text-xs text-slate-400 font-medium">Click or Drag & Drop standard RFC-4180 CSV file</p>
            </div>
          )}
        </div>

        {headers.length > 0 && (
          <div className="space-y-4 animate-fade-in border-t pt-6">
            <h3 className="font-bold text-slate-800 text-sm">CSV Column Mapping Specification</h3>
            <p className="text-xs text-slate-400 leading-normal">
              Map the headers found in your CSV sheet file to the mandatory fields in DSMNRU EventHub standard directory.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {requiredFields.map((field) => (
                <div key={field} className="flex items-center justify-between border-b pb-2 text-xs">
                  <label className="font-bold capitalize text-slate-600">{field.replace('_', ' ')} *</label>
                  <select
                    required
                    value={mapping[field]}
                    onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}
                    className="px-2 py-1 border rounded text-slate-700 font-semibold focus:outline-none"
                  >
                    <option value="">-- Choose CSV Column --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white py-3 rounded-lg font-bold text-xs shadow-sm transition flex items-center justify-center space-x-1.5"
            >
              {loading ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <CheckCircle className="w-4.5 h-4.5" />
                  <span>Analyze Spreadsheet & Preview</span>
                </>
              )}
            </button>
          </div>
        )}
      </form>

      {/* Preview Section & Commit Action */}
      {preview && (
        <div className="border-t pt-6 space-y-6 animate-fade-in">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Import Analysis Stats</h3>
              <p className="text-xs text-slate-400 mt-0.5">Please review the spreadsheet records analysis before applying transactions.</p>
            </div>
            <button
              onClick={handleApplyCommit}
              disabled={loading}
              className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-6 py-2.5 rounded-lg shadow-sm flex items-center space-x-1.5 transition"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Check className="w-4.5 h-4.5" />
                  <span>Apply Transaction & Commit Records</span>
                </>
              )}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-xs font-semibold text-center border p-4 rounded-xl">
            <div className="space-y-1">
              <span className="text-slate-400 text-[10px] uppercase font-bold">Total Rows</span>
              <p className="text-lg font-bold text-slate-800">{preview.total}</p>
            </div>
            <div className="space-y-1 border-l">
              <span className="text-slate-400 text-[10px] uppercase font-bold">New Records</span>
              <p className="text-lg font-bold text-green-600">{preview.newCount}</p>
            </div>
            <div className="space-y-1 border-l">
              <span className="text-slate-400 text-[10px] uppercase font-bold">Updated Details</span>
              <p className="text-lg font-bold text-primary-600">{preview.updatedCount}</p>
            </div>
            <div className="space-y-1 border-l">
              <span className="text-slate-400 text-[10px] uppercase font-bold">Ignored Duplicates</span>
              <p className="text-lg font-bold text-slate-500">{preview.duplicateCount}</p>
            </div>
            <div className="space-y-1 border-l">
              <span className="text-slate-400 text-[10px] uppercase font-bold text-red-500">Rejected Errors</span>
              <p className="text-lg font-bold text-red-600">{preview.rejectedCount}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// EVENT TAB: AGENDA MANAGEMENT
// ==========================================
function EventTabAgenda({ event }: { event: Event }) {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [desc, setDesc] = useState('');
  const [speaker, setSpeaker] = useState('');
  const [loc, setLoc] = useState('');

  const fetchAgenda = () => {
    setLoading(true);
    apiRequest<ScheduleItem[]>(`/schedule/events/${event.id}/schedule`)
      .then((data) => setItems(data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAgenda();
  }, [event.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !start || !end) return;

    try {
      await apiRequest(`/schedule/events/${event.id}/schedule`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          start_time: start,
          end_time: end,
          description: desc,
          speaker_name: speaker,
          location: loc
        })
      });
      setTitle('');
      setStart('');
      setEnd('');
      setDesc('');
      setSpeaker('');
      setLoc('');
      fetchAgenda();
    } catch (err: any) {
      alert(err.message || 'Failed to add agenda item');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      
      {/* Add Agenda Box */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4 h-fit">
        <h2 className="text-lg font-bold text-slate-800 border-b pb-2">Add Agenda Item</h2>
        <form onSubmit={handleSubmit} className="space-y-4 text-xs font-semibold text-slate-500">
          <div className="space-y-1">
            <label className="block uppercase font-bold text-slate-500">Activity Title *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Keynote Address / Lunch break"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block uppercase font-bold text-slate-500">Start Time *</label>
              <input
                type="text"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
                placeholder="e.g. 10:00 AM"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="block uppercase font-bold text-slate-500">End Time *</label>
              <input
                type="text"
                required
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                placeholder="e.g. 11:30 AM"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="block uppercase font-bold text-slate-500">Speaker / Panel Host (Optional)</label>
            <input
              type="text"
              value={speaker}
              onChange={(e) => setSpeaker(e.target.value)}
              placeholder="e.g. Prof. Lav Kush"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="block uppercase font-bold text-slate-500">Location Venue (Optional)</label>
            <input
              type="text"
              value={loc}
              onChange={(e) => setLoc(e.target.value)}
              placeholder="e.g. Main Hall"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="block uppercase font-bold text-slate-500">Brief Summary (Optional)</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Summary notes..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
            />
          </div>
          <button type="submit" className="w-full bg-primary-600 hover:bg-primary-700 text-white py-2.5 rounded-lg font-bold text-xs shadow-sm transition">
            Create Agenda Item
          </button>
        </form>
      </div>

      {/* Directory Listing */}
      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm h-fit">
        {loading ? (
          <div className="py-12 text-center">
            <RefreshCw className="w-8 h-8 text-primary-600 animate-spin mx-auto mb-2" />
            <p className="text-xs text-slate-500">Loading Agenda ledger...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold">No Agenda Items Configured</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 text-slate-700">
            {items.map((item) => (
              <div key={item.id} className="p-6 flex items-center justify-between text-xs hover:bg-slate-50 transition">
                <div className="space-y-1">
                  <h3 className="font-bold text-slate-800 text-sm">{item.title}</h3>
                  <p className="text-slate-500">{item.description}</p>
                  {item.speaker_name && <p className="text-primary-600 font-semibold">Host: {item.speaker_name}</p>}
                </div>
                <div className="text-right flex-shrink-0 space-y-1">
                  <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded block">{item.start_time} - {item.end_time}</span>
                  {item.location && <span className="text-slate-400 block">📍 {item.location}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

// ==========================================
// EVENT TAB: SPEAKER PANEL
// ==========================================
function EventTabPanel({ event }: { event: Event }) {
  const [items, setItems] = useState<Speaker[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [desg, setDesg] = useState('');
  const [inst, setInst] = useState('');
  const [bio, setBio] = useState('');

  const fetchSpeakers = () => {
    setLoading(true);
    apiRequest<Speaker[]>(`/speakers/events/${event.id}/speakers`)
      .then((data) => setItems(data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSpeakers();
  }, [event.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !desg || !inst) return;

    try {
      await apiRequest(`/speakers/events/${event.id}/speakers`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          designation: desg,
          institution: inst,
          biography: bio
        })
      });
      setName('');
      setDesg('');
      setInst('');
      setBio('');
      fetchSpeakers();
    } catch (err: any) {
      alert(err.message || 'Failed to add speaker');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      
      {/* Add Speaker Box */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4 h-fit">
        <h2 className="text-lg font-bold text-slate-800 border-b pb-2">Add Panel Speaker</h2>
        <form onSubmit={handleSubmit} className="space-y-4 text-xs font-semibold text-slate-500">
          <div className="space-y-1">
            <label className="block uppercase font-bold text-slate-500">Full Name *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dr. Ramesh Gupta"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="block uppercase font-bold text-slate-500">Designation *</label>
            <input
              type="text"
              required
              value={desg}
              onChange={(e) => setDesg(e.target.value)}
              placeholder="e.g. Senior Professor CS"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="block uppercase font-bold text-slate-500">Institution / University *</label>
            <input
              type="text"
              required
              value={inst}
              onChange={(e) => setInst(e.target.value)}
              placeholder="e.g. IIT Kanpur"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="block uppercase font-bold text-slate-500">Brief Biography (Optional)</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Biography notes..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
            />
          </div>
          <button type="submit" className="w-full bg-primary-600 hover:bg-primary-700 text-white py-2.5 rounded-lg font-bold text-xs shadow-sm transition">
            Create Speaker Record
          </button>
        </form>
      </div>

      {/* Panel Listing */}
      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm h-fit">
        {loading ? (
          <div className="py-12 text-center">
            <RefreshCw className="w-8 h-8 text-primary-600 animate-spin mx-auto mb-2" />
            <p className="text-xs text-slate-500">Loading panel ledger...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Briefcase className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold">No Speakers Added</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-6">
            {items.map((spk) => (
              <div key={spk.id} className="border rounded-xl p-4 flex space-x-3 text-xs">
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-lg flex-shrink-0">👤</div>
                <div className="space-y-0.5 min-w-0">
                  <h3 className="font-bold text-slate-800 truncate">{spk.name}</h3>
                  <p className="text-primary-600 font-semibold truncate">{spk.designation}</p>
                  <p className="text-slate-400 font-medium truncate">{spk.institution}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

// ==========================================
// EVENT TAB: BULLETIN ANNOUNCEMENTS
// ==========================================
function EventTabBulletins({ event }: { event: Event }) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [sendEmail, setSendEmail] = useState(false);

  const fetchBulletins = () => {
    setLoading(true);
    apiRequest<Announcement[]>(`/announcements/events/${event.id}/announcements`)
      .then((data) => setItems(data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchBulletins();
  }, [event.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !content) return;

    try {
      await apiRequest(`/announcements/events/${event.id}/announcements`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          content,
          priority,
          sendEmail
        })
      });
      setTitle('');
      setContent('');
      setPriority('normal');
      setSendEmail(false);
      fetchBulletins();
      alert('Bulletin announcement published successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to add announcement');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      
      {/* Add Bulletin Box */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4 h-fit">
        <h2 className="text-lg font-bold text-slate-800 border-b pb-2">Publish Bulletin Alert</h2>
        <form onSubmit={handleSubmit} className="space-y-4 text-xs font-semibold text-slate-500">
          <div className="space-y-1">
            <label className="block uppercase font-bold text-slate-500">Bulletin Title *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Schedule Change: Session starts 10:30 AM"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="block uppercase font-bold text-slate-500">Priority Level</label>
            <select
              value={priority}
              onChange={(e: any) => setPriority(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
            >
              <option value="low">Low Priority (info)</option>
              <option value="normal">Normal / Standard</option>
              <option value="high">High Alert</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="block uppercase font-bold text-slate-500">Bulletin Body Content *</label>
            <textarea
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Details to communicate..."
              rows={4}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
            />
          </div>
          <label className="flex items-center space-x-2 text-xs font-semibold text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
              className="rounded text-primary-600 focus:ring-primary-500"
            />
            <span>Broadcast email alert directly to all registered participants</span>
          </label>
          <button type="submit" className="w-full bg-primary-600 hover:bg-primary-700 text-white py-2.5 rounded-lg font-bold text-xs shadow-sm transition">
            Publish Bulletin
          </button>
        </form>
      </div>

      {/* Directory Listing */}
      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm h-fit">
        {loading ? (
          <div className="py-12 text-center">
            <RefreshCw className="w-8 h-8 text-primary-600 animate-spin mx-auto mb-2" />
            <p className="text-xs text-slate-500">Loading bulletins ledger...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Mail className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold">No Bulletins Posted</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 text-slate-700">
            {items.map((item) => (
              <div key={item.id} className="p-6 text-xs space-y-2 hover:bg-slate-50 transition">
                <div className="flex justify-between items-start">
                  <h3 className="font-bold text-slate-800 text-sm">{item.title}</h3>
                  <span className={`font-bold px-2 py-0.5 rounded text-[9px] uppercase tracking-wider ${
                    item.priority === 'high' ? 'bg-red-50 text-red-700' :
                    item.priority === 'normal' ? 'bg-slate-100 text-slate-700' :
                    'bg-slate-50 text-slate-400'
                  }`}>
                    {item.priority}
                  </span>
                </div>
                <p className="text-slate-500 whitespace-pre-wrap">{item.content}</p>
                <span className="text-[10px] text-slate-400 block pt-1">Posted: {new Date(item.published_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

// ==========================================
// EVENT TAB: REAL-TIME SCANNERS & ATTENDANCE
// ==========================================
function EventTabScanners({ event }: { event: Event }) {
  const [scannerMode, setScannerMode] = useState<'attendance' | 'resource' | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState('');
  
  // Scans ledger
  const [recentScans, setRecentScans] = useState<any[]>([]);
  const [counts, setCounts] = useState({ registered: 0, attended: 0, absent: 0 });

  // Camera scanner state
  const [scannerResult, setScannerResult] = useState<{ status: 'GREEN' | 'YELLOW' | 'RED'; message: string; name?: string } | null>(null);
  const [manualToken, setManualToken] = useState('');
  const [scanLoading, setScanLoading] = useState(false);

  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  // Dynamic Resource creation form states
  const [resName, setResName] = useState('');
  const [resQty, setResQty] = useState('');
  const [resElig, setResElig] = useState<'all' | 'attendees'>('all');

  const fetchResources = () => {
    apiRequest<Resource[]>(`/operations/events/${event.id}/resources`)
      .then((data) => {
        setResources(data || []);
        if (data.length > 0) setSelectedResourceId(data[0].id);
      })
      .catch(() => {});
  };

  const fetchDashboard = () => {
    apiRequest<any>(`/operations/events/${event.id}/dashboard`)
      .then((data) => {
        setCounts({
          registered: data.registered || 0,
          attended: data.attended || 0,
          absent: data.absent || 0
        });
        setRecentScans(data.recentScans || []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchResources();
    fetchDashboard();
  }, [event.id]);

  const handleCreateResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resName || !resQty) return;

    try {
      await apiRequest(`/operations/events/${event.id}/resources`, {
        method: 'POST',
        body: JSON.stringify({
          name: resName,
          quantity: parseInt(resQty, 10),
          eligibility: resElig
        })
      });
      setResName('');
      setResQty('');
      fetchResources();
      alert('Food/Resource Counter configured successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to configure resource');
    }
  };

  const lastScannedRef = useRef<{ token: string; timestamp: number } | null>(null);

  // Perform secure scan action on backend
  const executeScanAction = async (token: string) => {
    const now = Date.now();
    if (lastScannedRef.current && lastScannedRef.current.token === token && now - lastScannedRef.current.timestamp < 2000) {
      return;
    }
    lastScannedRef.current = { token, timestamp: now };

    if (scanLoading) return;
    setScanLoading(true);
    setScannerResult(null);

    const path =
      scannerMode === 'attendance'
        ? `/operations/events/${event.id}/attendance/scan`
        : `/operations/events/${event.id}/resources/${selectedResourceId}/scan`;

    try {
      const data = await apiRequest<any>(path, {
        method: 'POST',
        body: JSON.stringify({ opaque_token: token })
      });
      
      setScannerResult({
        status: data.status || 'GREEN',
        message: data.message || 'Verification success',
        name: data.participant?.name
      });
      fetchDashboard();
      fetchResources();
    } catch (err: any) {
      // D1 database uniqueness violations return 409 and status YELLOW
      const code = err.code || 'ERROR';
      const status = code === 'ALREADY_CLAIMED' ? 'YELLOW' : 'RED';
      setScannerResult({
        status,
        message: err.message || 'Failed to scan pass.'
      });
    } finally {
      setScanLoading(false);
    }
  };

  // Stop current active HTML5 camera scanner
  const stopCameraScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.clear();
      } catch (e) {
        // ignore clear error
      }
      scannerRef.current = null;
    }
  };

  // Start HTML5 Camera scanner
  const startCameraScanner = () => {
    stopCameraScanner().then(() => {
      setTimeout(() => {
        const scanner = new Html5QrcodeScanner(
          'qr-scanner-element',
          {
            fps: 15,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0
          },
          false
        );

        scanner.render(
          (decodedText) => {
            // Decoded opaque token found, execute secure verification immediately!
            if (decodedText && decodedText.trim()) {
              executeScanAction(decodedText.trim());
            }
          },
          () => {}
        );

        scannerRef.current = scanner;
      }, 300);
    });
  };

  useEffect(() => {
    if (scannerMode) {
      startCameraScanner();
    } else {
      stopCameraScanner();
    }
    return () => {
      stopCameraScanner();
    };
  }, [scannerMode, selectedResourceId]);

  return (
    <div className="space-y-8">
      {/* Selector Box */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
        <h2 className="text-xl font-bold text-slate-800">Campus Real-Time Gate Scanners</h2>
        <p className="text-xs text-slate-500 leading-normal">
          Select scanner counter type. Real-time scans verify opaque tokens dynamically, avoiding WebSocket load and race conditions.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => {
              setScannerMode(scannerMode === 'attendance' ? null : 'attendance');
              setScannerResult(null);
            }}
            className={`px-5 py-2.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 shadow-sm ${
              scannerMode === 'attendance'
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-white border hover:bg-slate-50 text-slate-700'
            }`}
          >
            <QrCode className="w-4 h-4" />
            <span>Attendance Counter</span>
          </button>

          {resources.length > 0 && (
            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  setScannerMode(scannerMode === 'resource' ? null : 'resource');
                  setScannerResult(null);
                }}
                className={`px-5 py-2.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 shadow-sm ${
                  scannerMode === 'resource'
                    ? 'bg-amber-600 text-white hover:bg-amber-700'
                    : 'bg-white border hover:bg-slate-50 text-slate-700'
                }`}
              >
                <Briefcase className="w-4 h-4" />
                <span>Food / Goodies Scanner</span>
              </button>
              {scannerMode === 'resource' && (
                <select
                  value={selectedResourceId}
                  onChange={(e) => {
                    setSelectedResourceId(e.target.value);
                    setScannerResult(null);
                  }}
                  className="px-3 py-2 border rounded-lg text-xs font-bold text-slate-700"
                >
                  {resources.map((r) => (
                    <option key={r.id} value={r.id}>{r.name} ({r.remaining} left)</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Scanner Screen Grid */}
      {scannerMode && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-fade-in">
          
          {/* Active Camera Panel */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-6 flex flex-col items-center justify-center space-y-4 shadow-md text-white min-h-[400px]">
            <span className="text-xs uppercase font-extrabold tracking-wider text-slate-400">
              Camera Scanner Screen - {scannerMode === 'attendance' ? 'Attendance Gate' : 'Food/Goodie Counter'}
            </span>
            <div id="qr-scanner-element" className="w-full max-w-sm rounded-xl overflow-hidden bg-slate-950 border border-slate-800"></div>
            
            {/* Manual Entry Fallback */}
            <div className="w-full max-w-sm flex items-center space-x-2 pt-2">
              <input
                type="text"
                placeholder="Enter token ID manually..."
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                className="bg-slate-800 text-white border border-slate-700 px-3 py-2 rounded-lg text-xs flex-grow focus:outline-none focus:ring-1 focus:ring-primary-500 font-mono"
              />
              <button
                onClick={() => {
                  if (manualToken.trim()) executeScanAction(manualToken.trim());
                }}
                className="bg-white text-slate-900 hover:bg-slate-100 text-xs font-bold px-4 py-2 rounded-lg transition"
              >
                Validate
              </button>
            </div>
          </div>

          {/* Feedback Screen */}
          <div className="flex flex-col justify-center items-center p-8 bg-white border border-slate-200 rounded-2xl shadow-sm min-h-[400px] text-center">
            {scanLoading ? (
              <div className="space-y-3">
                <RefreshCw className="w-12 h-12 text-slate-400 animate-spin mx-auto" />
                <h3 className="font-bold text-slate-700 text-sm">Querying D1 Ledger...</h3>
              </div>
            ) : scannerResult ? (
              <div className={`space-y-6 w-full max-w-sm p-6 rounded-2xl border ${
                scannerResult.status === 'GREEN' ? 'bg-green-50 border-green-200 text-green-800' :
                scannerResult.status === 'YELLOW' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                'bg-red-50 border-red-200 text-red-800'
              }`}>
                <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center text-3xl shadow-sm bg-white">
                  {scannerResult.status === 'GREEN' ? '✅' : scannerResult.status === 'YELLOW' ? '⚠️' : '❌'}
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-black uppercase tracking-wider">{scannerResult.status}</h3>
                  <p className="text-sm font-bold leading-normal">{scannerResult.message}</p>
                  {scannerResult.name && (
                    <p className="text-xs font-medium border-t border-dashed border-slate-300 pt-3 text-slate-600">
                      Participant: <span className="font-bold text-slate-800">{scannerResult.name}</span>
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-slate-400 space-y-4">
                <QrCode className="w-16 h-16 mx-auto stroke-1" />
                <div className="space-y-1">
                  <h3 className="font-bold text-slate-700 text-sm">Ready to scan opaque QR Pass</h3>
                  <p className="text-xs max-w-xs mx-auto leading-normal">
                    Point your device camera at the participant secure pass. The continuous scanner screen updates automatically.
                  </p>
                </div>
              </div>
            )}
          </div>

        </div>
      )}

      {/* Counters Config Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Create Resource counter */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4 h-fit">
          <h2 className="text-lg font-bold text-slate-800 border-b pb-2">Add Food/Goodies Counter</h2>
          <form onSubmit={handleCreateResource} className="space-y-4 text-xs font-semibold text-slate-500">
            <div className="space-y-1">
              <label className="block uppercase font-bold text-slate-500">Counter/Resource Name *</label>
              <input
                type="text"
                required
                value={resName}
                onChange={(e) => setResName(e.target.value)}
                placeholder="e.g. Lunch / Workshop Kits"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="block uppercase font-bold text-slate-500">Total Quantity Limit *</label>
              <input
                type="number"
                required
                value={resQty}
                onChange={(e) => setResQty(e.target.value)}
                placeholder="e.g. 500"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="block uppercase font-bold text-slate-500">Counter Eligibility</label>
              <select
                value={resElig}
                onChange={(e: any) => setResElig(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
              >
                <option value="all">All Registered Participants</option>
                <option value="attendees">Only Attendees Who Checked In</option>
              </select>
            </div>
            <button type="submit" className="w-full bg-primary-600 hover:bg-primary-700 text-white py-2.5 rounded-lg font-bold text-xs shadow-sm transition">
              Create Resource Counter
            </button>
          </form>
        </div>

        {/* Resources ledger */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm h-fit">
          <div className="p-4 border-b bg-slate-50">
            <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Configured Counters Registry</h3>
          </div>
          {resources.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-xs font-semibold">
              <Briefcase className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p>No Food or Kits Counters Configured</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-500 border-b font-bold uppercase text-[9px] tracking-wider">
                  <th className="p-4">Counter Name</th>
                  <th className="p-4">Eligibility Scope</th>
                  <th className="p-4">Remaining capacity</th>
                </tr>
              </thead>
              <tbody className="divide-y text-slate-700">
                {resources.map((r) => (
                  <tr key={r.id}>
                    <td className="p-4 font-bold text-slate-800">{r.name}</td>
                    <td className="p-4 capitalize font-semibold">{r.eligibility}</td>
                    <td className="p-4 font-bold">
                      <span className={`px-2 py-0.5 rounded text-[10px] uppercase ${r.remaining > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700 animate-pulse'}`}>
                        {r.remaining} of {r.quantity} left
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}

// ==========================================
// EVENT TAB: CLIENT-SIDE BULK CERTIFICATES ENGINE
// ==========================================
function EventTabCertificates({ event }: { event: Event }) {
  const [templateName, setTemplateName] = useState('');
  const [certType, setCertType] = useState('Participation');
  const [bgImageUrl, setBgImageUrl] = useState('');
  const [layout, setLayout] = useState({
    titleText: 'CERTIFICATE OF PARTICIPATION',
    font: 'Helvetica',
    fontSize: 36,
    color: '#1e293b',
    nameY: 150,
    bodyText: 'This is to certify that {{participant_name}} has successfully participated in the academic session {{event_name}} hosted by the department of {{department}} on {{event_date}}.',
    bodyY: 190,
    bodySize: 16
  });

  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const fetchRecords = () => {
    apiRequest<any>(`/certificates/events/${event.id}/issued?limit=15`)
      .then((data) => setRecords(data.records || []))
      .catch(() => {});
  };

  useEffect(() => {
    fetchRecords();
  }, [event.id]);

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateName) return;

    try {
      await apiRequest(`/certificates/events/${event.id}/templates`, {
        method: 'POST',
        body: JSON.stringify({
          name: templateName,
          bg_image_url: bgImageUrl,
          layout_json: layout,
          certificate_type: certType
        })
      });
      alert('Event certificate template settings saved successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to save template settings.');
    }
  };

  // Browser-Side Bulk Generation Logic (Absolutely no PDF storage on server!)
  const handleBulkGenerate = async () => {
    setBulkLoading(true);
    setProgress(0);

    try {
      // 1. Fetch participants list
      const regsData = await apiRequest<any>(`/registrations/events/${event.id}/registrations?limit=1000`);
      const list = regsData.registrations || [];

      if (list.length === 0) {
        alert('No registered participants found to generate certificates!');
        setBulkLoading(false);
        return;
      }

      // 2. Queue metadata creation in database (generates unique certificate IDs)
      const pPayload = list.map((p: any) => ({
        registration_id: p.registration_id,
        full_name: p.full_name
      }));

      const issueData = await apiRequest<any[]>(`/certificates/events/${event.id}/issue`, {
        method: 'POST',
        body: JSON.stringify({
          participants: pPayload,
          certificate_type: certType
        })
      });

      // Map unique certificate IDs to participants list
      const certIdMap = new Map<string, string>();
      for (const item of issueData) {
        certIdMap.set(item.registration_id, item.certificate_id);
      }

      // 3. Initiate client-side PDF creation and ZIP packing
      const zip = new JSZip();

      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const certId = certIdMap.get(p.registration_id) || `DSMNRU-TEMP-${Math.random().toString(36).substring(7).toUpperCase()}`;

        // Create PDF Document using jsPDF
        const doc = new jsPDF({
          orientation: 'landscape',
          unit: 'mm',
          format: 'a4'
        });

        const width = doc.internal.pageSize.getWidth(); // A4 Landscape: ~297mm
        
        // Draw elegant standard border
        doc.setDrawColor(46, 87, 134); // Primary border color
        doc.setLineWidth(2);
        doc.rect(10, 10, width - 20, 190);

        doc.setDrawColor(219, 229, 240); // Double inner border
        doc.setLineWidth(0.5);
        doc.rect(12, 12, width - 24, 186);

        // Header Title
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(46, 87, 134);
        doc.text('DR. SHAKUNTALA MISRA NATIONAL REHABILITATION UNIVERSITY, LUCKNOW', width / 2, 30, { align: 'center' });

        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text('State University established under Govt. of Uttar Pradesh', width / 2, 36, { align: 'center' });

        // Certificate Category Banner
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(22);
        doc.setTextColor(30, 41, 59);
        doc.text(layout.titleText.toUpperCase(), width / 2, 58, { align: 'center' });

        // Participant Name
        doc.setFont('Helvetica', 'italic');
        doc.setFontSize(18);
        doc.setTextColor(100);
        doc.text('This is proudly presented to', width / 2, 78, { align: 'center' });

        // Hindi/Unicode support: standard fallback font handles spaces and hyphens cleanly in jsPDF
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(32);
        doc.setTextColor(46, 87, 134);
        doc.text(p.full_name, width / 2, 98, { align: 'center' });

        // Certificate Dynamic Body Compilation
        let compiledBody = layout.bodyText;
        compiledBody = compiledBody.replaceAll('{{participant_name}}', p.full_name);
        compiledBody = compiledBody.replaceAll('{{event_name}}', event.name);
        compiledBody = compiledBody.replaceAll('{{department}}', event.department_name || 'Department');
        compiledBody = compiledBody.replaceAll('{{event_date}}', event.start_date);

        // Wrap dynamic text inside margins to prevent width spilling
        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(14);
        doc.setTextColor(70);
        const splitText = doc.splitTextToSize(compiledBody, width - 60);
        doc.text(splitText, width / 2, 118, { align: 'center' });

        // Draw elegant verification footer (with Verification QR box coordinates)
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(`Digital Registry Certificate ID: ${certId}`, 20, 185);
        doc.text(`Verify Authenticity instantly at: ${window.location.origin}/verify/${certId}`, 20, 190);

        doc.setDrawColor(200);
        doc.rect(width - 50, 160, 30, 30, 'S');
        doc.setFontSize(6);
        doc.text('QR VERIFIED', width - 35, 177, { align: 'center' });

        // Convert PDF to bytes array and load to JSZip
        const pdfBytes = doc.output('arraybuffer');
        
        // Secure Sanitized Filename formatting: Acronym_StudentName.pdf
        const cleanName = p.full_name.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = `${event.short_name.toUpperCase()}_${cleanName}.pdf`;
        zip.file(filename, pdfBytes);

        // Update progress count
        setProgress(Math.round(((i + 1) / list.length) * 100));
      }

      // 4. Generate final ZIP folder and trigger immediate client download
      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `${event.short_name.toUpperCase()}_Certificates.zip`;
      link.click();

      fetchRecords();
      alert('Certificates ZIP downloaded successfully to your local device!');
    } catch (err: any) {
      alert(err.message || 'Generation failed.');
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      
      {/* Template Setup panel */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4 h-fit">
        <h2 className="text-lg font-bold text-slate-800 border-b pb-2">Certificate Template Editor</h2>
        <form onSubmit={handleSaveTemplate} className="space-y-4 text-xs font-semibold text-slate-500">
          <div className="space-y-1">
            <label className="block uppercase font-bold text-slate-500">Template Title *</label>
            <input
              type="text"
              required
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. Standard Participation Layout"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="block uppercase font-bold text-slate-500">Scope Type</label>
            <select
              value={certType}
              onChange={(e) => setCertType(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
            >
              <option value="Participation">Participation</option>
              <option value="Appreciation">Appreciation</option>
              <option value="Winner">Winner</option>
              <option value="Volunteer">Volunteer Scanner</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="block uppercase font-bold text-slate-500">Center Text Coordinate (Title)</label>
            <input
              type="text"
              required
              value={layout.titleText}
              onChange={(e) => setLayout({ ...layout, titleText: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="block uppercase font-bold text-slate-500">Dynamic Description text template</label>
            <textarea
              required
              value={layout.bodyText}
              onChange={(e) => setLayout({ ...layout, bodyText: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
            />
          </div>
          <button type="submit" className="w-full bg-slate-900 hover:bg-slate-800 text-white py-2.5 rounded-lg font-bold text-xs shadow-sm transition">
            Save Template Settings
          </button>
        </form>
      </div>

      {/* Generation dashboard Panel */}
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-8 shadow-sm text-center space-y-6">
          <FileText className="w-16 h-16 text-primary-600 mx-auto stroke-1" />
          <div className="max-w-md mx-auto space-y-2">
            <h3 className="font-extrabold text-lg text-slate-800">Browser-Side Bulk certificates Builder</h3>
            <p className="text-xs text-slate-500 leading-normal">
              Parses the registered participants catalog, generates dynamic high-fidelity PDFs, compiles into a ZIP folder, and triggers a direct browser download. Absolute zero server storage payload.
            </p>
          </div>

          {bulkLoading ? (
            <div className="space-y-3 max-w-sm mx-auto">
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div className="bg-green-600 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
              </div>
              <p className="text-xs font-bold text-green-700 animate-pulse">Compiling PDF Zip: {progress}% Complete...</p>
            </div>
          ) : (
            <button
              onClick={handleBulkGenerate}
              className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-8 py-3.5 rounded-xl shadow-md transition flex items-center justify-center space-x-1.5 mx-auto"
            >
              <Download className="w-5 h-5" />
              <span>Initiate bulk Certificates ZIP Download</span>
            </button>
          )}
        </div>

        {/* Dynamic Issued Table preview */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b bg-slate-50">
            <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Recently Issued Log registry</h3>
          </div>
          {records.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No Issued Registry Log available.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-500 border-b font-bold uppercase text-[9px] tracking-wider">
                  <th className="p-4">Certificate ID</th>
                  <th className="p-4">Name</th>
                  <th className="p-4">Scope</th>
                  <th className="p-4 text-right">Date Issued</th>
                </tr>
              </thead>
              <tbody className="divide-y text-slate-700">
                {records.map((r) => (
                  <tr key={r.certificate_id} className="hover:bg-slate-50 transition">
                    <td className="p-4 font-mono font-bold text-slate-900">{r.certificate_id}</td>
                    <td className="p-4 font-semibold">{r.participant_name}</td>
                    <td className="p-4 capitalize">{r.certificate_type}</td>
                    <td className="p-4 text-right text-slate-400 font-mono">{r.issued_at.split('T')[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  );
}

// ==========================================
// EVENT TAB: EMAIL DELIVERY CAMPAIGNS
// ==========================================
function EventTabCampaigns({ event }: { event: Event }) {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [filter, setFilter] = useState('all');

  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [campaignLoading, setCampaignLoading] = useState(false);

  const fetchCampaignsAndLogs = () => {
    setLoading(true);
    Promise.all([
      apiRequest<any[]>(`/emails/events/${event.id}/campaigns`),
      apiRequest<any>(`/emails/events/${event.id}/logs?limit=15`)
    ])
      .then(([cam, lg]) => {
        setCampaigns(cam || []);
        setLogs(lg.logs || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchCampaignsAndLogs();
  }, [event.id]);

  const handleCreateCampaignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !subject || !bodyHtml) return;

    setCampaignLoading(true);
    try {
      // Estimate recipient count
      const regs = await apiRequest<any>(`/registrations/events/${event.id}/registrations?limit=1000`);
      const list = regs.registrations || [];
      
      setEstimatedCount(list.length);
      setShowConfirm(true);
    } catch (err: any) {
      alert(err.message || 'Analysis failed');
    } finally {
      setCampaignLoading(false);
    }
  };

  const handleConfirmSend = async () => {
    if (!title || !subject || !bodyHtml) return;
    setCampaignLoading(true);

    try {
      await apiRequest(`/emails/events/${event.id}/campaign`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          subject,
          body_html: bodyHtml,
          recipient_filter: filter
        })
      });
      setTitle('');
      setSubject('');
      setBodyHtml('');
      setShowConfirm(false);
      setEstimatedCount(null);
      fetchCampaignsAndLogs();
      alert('Email delivery campaign queued and triggered asynchronously!');
    } catch (err: any) {
      alert(err.message || 'Queuing campaign failed.');
    } finally {
      setCampaignLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      
      {/* Create Campaign Box */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4 h-fit">
        <h2 className="text-lg font-bold text-slate-800 border-b pb-2">Add Email Campaign</h2>
        
        {showConfirm ? (
          <div className="space-y-4 border border-dashed border-primary-200 rounded-xl p-4 bg-primary-50/20 text-xs">
            <h3 className="font-bold text-primary-800 text-sm">Review Campaign Safeguard</h3>
            <div className="space-y-2 text-slate-700">
              <p>Target Recipients: <span className="font-bold">{estimatedCount}</span></p>
              <p>Subject: <span className="font-bold text-slate-900">{subject}</span></p>
              <p className="text-slate-500 leading-normal">
                Emails are processed asynchronously by our ₹0 Worker waitUntil thread queue. This safeguards the server against automated rate exhausts.
              </p>
            </div>
            <div className="pt-2 flex justify-between gap-3">
              <button onClick={() => setShowConfirm(false)} className="text-slate-500 hover:text-slate-800 font-bold transition">
                Cancel
              </button>
              <button
                onClick={handleConfirmSend}
                disabled={campaignLoading}
                className="bg-green-600 hover:bg-green-700 text-white font-bold px-4 py-2 rounded shadow-sm transition"
              >
                Confirm Send Campaign
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreateCampaignSubmit} className="space-y-4 text-xs font-semibold text-slate-500">
            <div className="space-y-1">
              <label className="block uppercase font-bold text-slate-500">Campaign Title *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Workshop Entrance QR passes broadcast"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="block uppercase font-bold text-slate-500">Email Subject Line *</label>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. DSMNRU Workshop: Your Pass inside"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="block uppercase font-bold text-slate-500">Recipients Filter</label>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs"
              >
                <option value="all">All Registered Participants</option>
                <option value="attendees">Only Attendees Who Checked In</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="block uppercase font-bold text-slate-500">Body Content HTML *</label>
              <textarea
                required
                value={bodyHtml}
                onChange={(e) => setBodyHtml(e.target.value)}
                placeholder="<h3>Hello {{recipient_name}},</h3><p>Your details are secured...</p>"
                rows={5}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-800 text-xs font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={campaignLoading}
              className="w-full bg-primary-600 hover:bg-primary-700 text-white py-2.5 rounded-lg font-bold text-xs shadow-sm transition flex items-center justify-center space-x-1"
            >
              {campaignLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <span>Analyze Recipients</span>}
            </button>
          </form>
        )}
      </div>

      {/* Directory and logs Panels */}
      <div className="lg:col-span-2 space-y-6">
        
        {/* Campaign List */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm h-fit">
          <div className="p-4 border-b bg-slate-50">
            <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Campaigns History registry</h3>
          </div>
          {loading ? (
            <div className="py-12 text-center">
              <RefreshCw className="w-8 h-8 text-primary-600 animate-spin mx-auto mb-2" />
              <p className="text-xs text-slate-500">Checking registry...</p>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No Campaigns Queued.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-500 border-b font-bold uppercase text-[9px] tracking-wider">
                  <th className="p-4">Title</th>
                  <th className="p-4">Subject</th>
                  <th className="p-4">Recipients Filter</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y text-slate-700">
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td className="p-4 font-bold">{c.title}</td>
                    <td className="p-4 truncate max-w-xs">{c.subject}</td>
                    <td className="p-4 capitalize font-semibold">{c.recipient_filter}</td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                        c.status === 'SENT' ? 'bg-green-50 text-green-700' :
                        c.status === 'QUEUED' ? 'bg-amber-50 text-amber-700 animate-pulse' :
                        'bg-red-50 text-red-700'
                      }`}>
                        {c.status} ({c.sent_jobs}/{c.total_jobs})
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Email Logs */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm h-fit">
          <div className="p-4 border-b bg-slate-50">
            <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Failed / Delivered Logs</h3>
          </div>
          {loading ? (
            <div className="py-12 text-center">
              <RefreshCw className="w-8 h-8 text-primary-600 animate-spin mx-auto mb-2" />
            </div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No recent delivery logs located.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-500 border-b font-bold uppercase text-[9px] tracking-wider">
                  <th className="p-4">Recipient</th>
                  <th className="p-4">Subject</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Provider Details</th>
                </tr>
              </thead>
              <tbody className="divide-y text-slate-700">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50 transition">
                    <td className="p-4 font-bold">{l.recipient}</td>
                    <td className="p-4 truncate max-w-xs">{l.subject}</td>
                    <td className="p-4 font-mono font-bold">
                      <span className={l.status === 'SENT' ? 'text-green-600' : 'text-red-600'}>
                        {l.status}
                      </span>
                    </td>
                    <td className="p-4 text-[10px] text-slate-400 font-mono truncate max-w-xs" title={l.error || l.provider_message_id}>
                      {l.error || l.provider_message_id}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  );
}

function EventTabVolunteers({ event }: { event: Event }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [scanAtt, setScanAtt] = useState(true);
  const [scanRes, setScanRes] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [list, setList] = useState<any[]>([]);

  const load = () => {
    apiRequest<any[]>(`/staff/volunteers?event_id=${event.id}`).then((d) => setList(d || [])).catch(() => {});
  };
  useEffect(() => { load(); }, [event.id]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <form
        className="bg-white border rounded-xl p-6 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const permissions = [
            ...(scanAtt ? ['SCAN_ATTENDANCE'] : []),
            ...(scanRes ? ['SCAN_RESOURCE'] : [])
          ];
          const res = await apiRequest<any>('/staff/volunteers', {
            method: 'POST',
            body: JSON.stringify({ email, full_name: name, phone, event_id: event.id, permissions })
          });
          setToken(res.setup_token || null);
          setName('');
          setEmail('');
          setPhone('');
          load();
        }}
      >
        <h2 className="font-bold text-slate-800">Add volunteer</h2>
        <input className="w-full border rounded px-3 py-2 text-sm" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className="w-full border rounded px-3 py-2 text-sm" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="w-full border rounded px-3 py-2 text-sm" placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={scanAtt} onChange={(e) => setScanAtt(e.target.checked)} /> SCAN_ATTENDANCE</label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={scanRes} onChange={(e) => setScanRes(e.target.checked)} /> SCAN_RESOURCE</label>
        <button className="bg-primary-600 text-white text-xs font-bold px-4 py-2 rounded">Create volunteer</button>
        {token && <p className="text-xs">Setup: /setup-password?token={token}</p>}
      </form>
      <div className="bg-white border rounded-xl p-6">
        <h3 className="font-bold text-sm mb-3">Assigned volunteers</h3>
        <ul className="text-sm space-y-2">{list.map((v) => <li key={v.id}>{v.full_name} — {v.email}</li>)}</ul>
      </div>
    </div>
  );
}
