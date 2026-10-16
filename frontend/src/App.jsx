import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Login from './Login';
import Layout from './Layout';
import PocSearch from './PocSearch';
import PocHeaderForm from './PocHeaderForm';
import PocEdit from './PocEdit';
import BpoForm from './BpoForm';
import Users from './Users';
import HolidaySearch from './HolidaySearch';
import HolidayForm from './HolidayForm';
import LineMaster from './LineMaster';
import SewingOrderBoard from './SewingOrderBoard';
import PlanningBoard from './PlanningBoard';
import ProductionUnits from './ProductionUnits';
import CapacityBuilding from './CapacityBuilding';

const readStoredUser = () => {
  try {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  } catch (err) {
    console.error('Corrupted user data in localStorage, clearing it:', err);
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    return null;
  }
};

function App() {
  const [user, setUser] = useState(readStoredUser);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  if (!user) {
    return <Login onLoginSuccess={setUser} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout user={user} onLogout={handleLogout} />}>
          <Route path="/" element={<PocSearch />} />
          <Route path="/poc/new" element={<PocHeaderForm />} />
          <Route path="/poc/:id/edit" element={<PocEdit />} />
          <Route path="/poc/:id/bpo" element={<BpoForm />} />
          <Route path="/users" element={<Users />} />
          <Route path="/holiday" element={<HolidaySearch />} />
          <Route path="/holiday/new" element={<HolidayForm />} />
          <Route path="/holiday/:id/edit" element={<HolidayForm />} />
          <Route path="/line-master" element={<LineMaster />} />
          <Route path="/sewing-orders" element={<SewingOrderBoard />} />
          <Route path="/planning-board" element={<PlanningBoard />} />
          <Route path="/production-units" element={<ProductionUnits />} />
          <Route path="/capacity" element={<CapacityBuilding />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
