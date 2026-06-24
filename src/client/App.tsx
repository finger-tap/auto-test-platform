import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { EnvironmentProvider } from './contexts/EnvironmentContext';
import ProtectedRoute from './components/ProtectedRoute';
import HomeLayout from './components/HomeLayout';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import Home from './pages/Home';
import ApiTestHome from './pages/ApiTestHome';
import ApiList from './pages/api-test/ApiList';
import ApiDetail from './pages/api-test/ApiDetail';
import ScenarioList from './pages/scenario/ScenarioList';
import ScenarioDetail from './pages/scenario/ScenarioDetail';
import ScenarioSetList from './pages/scenario-set/ScenarioSetList';
import ScenarioSetDetail from './pages/scenario-set/ScenarioSetDetail';
import CaseSetList from './pages/case-set/CaseSetList';
import CaseSetDetail from './pages/case-set/CaseSetDetail';
import MockList from './pages/mock/MockList';
import MockDetail from './pages/mock/MockDetail';
import ScheduleList from './pages/schedule/ScheduleList';
import EnvironmentList from './pages/environment/EnvironmentList';
import EnvironmentDetail from './pages/environment/EnvironmentDetail';
import SystemConfig from './pages/system/SystemConfig';
import MobileTestHome from './pages/mobile-test/MobileTestHome';
import MobileTestList from './pages/mobile-test/MobileTestList';
import MobileTestDetail from './pages/mobile-test/MobileTestDetail';
import AppList from './pages/mobile-test/AppList';
import AppDetail from './pages/mobile-test/AppDetail';
import WebTestHome from './pages/web-test/WebTestHome';
import WebCaseList from './pages/web-test/WebCaseList';
import WebCaseDetail from './pages/web-test/WebCaseDetail';
import PcTestHome from './pages/pc-test/PcTestHome';
import PcCaseList from './pages/pc-test/PcCaseList';
import PcCaseDetail from './pages/pc-test/PcCaseDetail';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <EnvironmentProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route element={<ProtectedRoute />}>
              {/* 项目首页：带背景 + 测试类型弹窗 */}
              <Route element={<HomeLayout />}>
                <Route path="/" element={<Home />} />
              </Route>
              {/* 测试工作页：带侧边栏 */}
              <Route element={<Layout />}>
                {/* === 接口测试 /api-test === */}
                <Route path="/api-test" element={<ApiTestHome />} />
                <Route path="/api-test/case" element={<ApiList />} />
                <Route path="/api-test/case/new" element={<ApiDetail />} />
                <Route path="/api-test/case/:id" element={<ApiDetail />} />
                <Route path="/api-test/scene" element={<ScenarioList basePath="/api-test" testType="api" />} />
                <Route path="/api-test/scene/:id" element={<ScenarioDetail basePath="/api-test" testType="api" />} />
                <Route path="/api-test/case-set" element={<ScenarioSetList basePath="/api-test" testType="api" />} />
                <Route path="/api-test/case-set/:id" element={<ScenarioSetDetail basePath="/api-test" testType="api" />} />
                <Route path="/api-test/schedule" element={<ScheduleList basePath="/api-test" />} />
                <Route path="/api-test/mock" element={<MockList />} />
                <Route path="/api-test/mock/:id" element={<MockDetail />} />
                <Route path="/api-test/environment" element={<EnvironmentList basePath="/api-test" />} />
                <Route path="/api-test/environment/new" element={<EnvironmentDetail basePath="/api-test" />} />
                <Route path="/api-test/environment/:id" element={<EnvironmentDetail basePath="/api-test" />} />
                <Route path="/api-test/system-config" element={<SystemConfig />} />

                {/* === Web测试 /web-test === */}
                <Route path="/web-test" element={<WebTestHome />} />
                <Route path="/web-test/case" element={<WebCaseList />} />
                <Route path="/web-test/case/new" element={<WebCaseDetail />} />
                <Route path="/web-test/case/:id" element={<WebCaseDetail />} />
                <Route path="/web-test/case-set" element={<CaseSetList basePath="/web-test" testType="web" />} />
                <Route path="/web-test/case-set/:id" element={<CaseSetDetail basePath="/web-test" testType="web" />} />
                <Route path="/web-test/schedule" element={<ScheduleList basePath="/web-test" />} />
                <Route path="/web-test/environment" element={<EnvironmentList basePath="/web-test" />} />
                <Route path="/web-test/environment/new" element={<EnvironmentDetail basePath="/web-test" />} />
                <Route path="/web-test/environment/:id" element={<EnvironmentDetail basePath="/web-test" />} />
                <Route path="/web-test/system-config" element={<SystemConfig />} />

                {/* === 移动端测试 /mobile-test === */}
                <Route path="/mobile-test" element={<MobileTestHome />} />
                <Route path="/mobile-test/case" element={<MobileTestList />} />
                <Route path="/mobile-test/case/new" element={<MobileTestDetail />} />
                <Route path="/mobile-test/case/:id" element={<MobileTestDetail />} />
                <Route path="/mobile-test/case-set" element={<CaseSetList basePath="/mobile-test" testType="mobile" />} />
                <Route path="/mobile-test/case-set/:id" element={<CaseSetDetail basePath="/mobile-test" testType="mobile" />} />
                <Route path="/mobile-test/schedule" element={<ScheduleList basePath="/mobile-test" />} />
                <Route path="/mobile-test/environment" element={<EnvironmentList basePath="/mobile-test" />} />
                <Route path="/mobile-test/environment/new" element={<EnvironmentDetail basePath="/mobile-test" />} />
                <Route path="/mobile-test/environment/:id" element={<EnvironmentDetail basePath="/mobile-test" />} />
                <Route path="/mobile-test/system-config" element={<SystemConfig />} />
                <Route path="/mobile-test/apps" element={<AppList />} />
                <Route path="/mobile-test/apps/new" element={<AppDetail />} />
                <Route path="/mobile-test/apps/:id" element={<AppDetail />} />

                {/* === PC测试 /pc-test === */}
                <Route path="/pc-test" element={<PcTestHome />} />
                <Route path="/pc-test/case" element={<PcCaseList />} />
                <Route path="/pc-test/case/new" element={<PcCaseDetail />} />
                <Route path="/pc-test/case/:id" element={<PcCaseDetail />} />
                <Route path="/pc-test/case-set" element={<CaseSetList basePath="/pc-test" testType="pc" />} />
                <Route path="/pc-test/case-set/:id" element={<CaseSetDetail basePath="/pc-test" testType="pc" />} />
                <Route path="/pc-test/schedule" element={<ScheduleList basePath="/pc-test" />} />
                <Route path="/pc-test/environment" element={<EnvironmentList basePath="/pc-test" />} />
                <Route path="/pc-test/environment/new" element={<EnvironmentDetail basePath="/pc-test" />} />
                <Route path="/pc-test/environment/:id" element={<EnvironmentDetail basePath="/pc-test" />} />
                <Route path="/pc-test/system-config" element={<SystemConfig />} />
              </Route>

              {/* 旧路径 redirect 兜底 — 设置页现在是 SysHeader 内的 Drawer,不再有独立路由 */}
              <Route path="/settings/*" element={<Navigate to="/" replace />} />
              <Route path="/profile" element={<Navigate to="/" replace />} />
              <Route path="/change-password" element={<Navigate to="/" replace />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </EnvironmentProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;