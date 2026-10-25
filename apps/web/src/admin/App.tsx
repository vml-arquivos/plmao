import { Navigate, Route, Routes } from 'react-router-dom';
import { PageLoading } from '../shared/ui';
import { useAdminSession } from './session';
import AdminLayout, { firstAllowedRoute } from './layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { QueriesList, QueryDetailPage } from './pages/Queries';
import Customers, { CustomerDetail } from './pages/Customers';
import Dealerships from './pages/Dealerships';
import Companies, { CompanyDetail } from './pages/Companies';
import Team from './pages/Team';
import Charges from './pages/Charges';
import Fiscal from './pages/Fiscal';
import Contracts from './pages/Contracts';
import Payments from './pages/Payments';
import Coupons from './pages/Coupons';
import Support from './pages/Support';
import Audit from './pages/Audit';
import Finance from './pages/Finance';
import Pricing from './pages/Pricing';
import Simulator from './pages/Simulator';
import Catalog from './pages/Catalog';
import Faqs from './pages/Faqs';
import Testimonials from './pages/Testimonials';
import Integrations from './pages/Integrations';
import VehicleGuide, { VehicleEdit } from './pages/Vehicles';
import Articles from './pages/Articles';
import Partners from './pages/Partners';
import System from './pages/System';
import Account from './pages/Account';

export default function App() {
  const { user, ready, can } = useAdminSession();
  if (!ready) return <PageLoading />;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={can('VIEW_DASHBOARD') ? <Dashboard /> : <Navigate to={firstAllowedRoute(can)} replace />} />
        <Route path="consultas" element={<QueriesList />} />
        <Route path="consultas/:id" element={<QueryDetailPage />} />
        <Route path="clientes" element={<Customers />} />
        <Route path="clientes/:id" element={<CustomerDetail />} />
        <Route path="lojas" element={<Dealerships />} />
        <Route path="empresas" element={<Companies />} />
        <Route path="empresas/:id" element={<CompanyDetail />} />
        <Route path="equipe" element={<Team />} />
        <Route path="cobrancas" element={<Charges />} />
        <Route path="notas-fiscais" element={<Fiscal />} />
        <Route path="contratos" element={<Contracts />} />
        <Route path="usuarios" element={<Navigate to="/clientes" replace />} />
        <Route path="suporte" element={<Support />} />
        <Route path="financeiro" element={<Finance />} />
        <Route path="precos" element={<Pricing />} />
        <Route path="simulador" element={<Simulator />} />
        <Route path="catalogo" element={<Catalog />} />
        <Route path="guia" element={<VehicleGuide />} />
        <Route path="guia/:id" element={<VehicleEdit />} />
        <Route path="faq" element={<Faqs />} />
        <Route path="depoimentos" element={<Testimonials />} />
        <Route path="integracoes" element={<Integrations />} />
        <Route path="artigos" element={<Articles />} />
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
