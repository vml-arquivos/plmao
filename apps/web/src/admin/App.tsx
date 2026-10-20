import { Navigate, Route, Routes } from 'react-router-dom';
import { PageLoading } from '../shared/ui';
import { useAdminSession } from './session';
import AdminLayout from './layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { QueriesList, QueryDetailPage } from './pages/Queries';
import Users from './pages/Users';
import Payments from './pages/Payments';
import Coupons from './pages/Coupons';
import Support from './pages/Support';
import Audit from './pages/Audit';
import Finance from './pages/Finance';
import Pricing from './pages/Pricing';
import Partners from './pages/Partners';
import System from './pages/System';
import Account from './pages/Account';

export default function App() {
  const { user, ready } = useAdminSession();
  if (!ready) return <PageLoading />;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="consultas" element={<QueriesList />} />
        <Route path="consultas/:id" element={<QueryDetailPage />} />
        <Route path="usuarios" element={<Users />} />
        <Route path="suporte" element={<Support />} />
        <Route path="financeiro" element={<Finance />} />
        <Route path="precos" element={<Pricing />} />
        <Route path="pagamentos" element={<Payments />} />
        <Route path="cupons" element={<Coupons />} />
        <Route path="parceiros" element={<Partners />} />
        <Route path="auditoria" element={<Audit />} />
        <Route path="sistema" element={<System />} />
        <Route path="conta" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
