import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { EnvironmentProvider } from './contexts/EnvironmentContext';
import ProtectedRoute from './components/ProtectedRoute';
import HomeLayout from './components/HomeLayout';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ChangePassword from './pages/ChangePassword';
import Home from './pages/Home';
import ApiTestHome from './pages/ApiTestHome';
import ApiList from './pages/api-test/ApiList';
import ApiDetail from './pages/api-test/ApiDetail';
import ScenarioList from './pages/scenario/ScenarioList';
import ScenarioDetail from './pages/scenario/ScenarioDetail';
import ScenarioSetList from './pages/scenario-set/ScenarioSetList';
import ScenarioSetDetail from './pages/scenario-set/ScenarioSetDetail';
import MockList from './pages/mock/MockList';
import MockDetail from './pages/mock/MockDetail';
import BatchReportList from './pages/batch-report/BatchReportList';
import BatchReportDetail from './pages/batch-report/BatchReportDetail';
import ScheduleList from './pages/schedule/ScheduleList';
import ScheduleDetail from './pages/schedule/ScheduleDetail';
import EnvironmentList from './pages/environment/EnvironmentList';
import EnvironmentDetail from './pages/environment/EnvironmentDetail';
import SystemConfig from './pages/system/SystemConfig';
import MobileTestHome from './pages/mobile-test/MobileTestHome';
import MobileTestList from './pages/mobile-test/MobileTestList';
import MobileTestDetail from './pages/mobile-test/MobileTestDetail';
import WebTestHome from './pages/web-test/WebTestHome';
import WebCaseList from './pages/web-test/WebCaseList';
import WebCaseDetail from './pages/web-test/WebCaseDetail';
import PcTestHome from './pages/pc-test/PcTestHome';
import PcCaseList from './pages/pc-test/PcCaseList';
import PcCaseDetail from './pages/pc-test/PcCaseDetail';
import Profile from './pages/Profile';
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
                <Route path="/profile" element={<Profile />} />
                <Route path="/change-password" element={<ChangePassword />} />
                
                {/* === 接口测试 /api-test === */}
                <Route path="/api-test" element={<ApiTestHome />} />
                <Route path="/api-test/api-case" element={<ApiList />} />
                <Route path="/api-test/api-case/new" element={<ApiDetail />} />
                <Route path="/api-test/api-case/:id" element={<ApiDetail />} />
                <Route path="/api-test/scene-case" element={<ScenarioList basePath="/api-test" testType="api" />} />
                <Route path="/api-test/scene-case/:id" element={<ScenarioDetail basePath="/api-test" testType="api" />} />
                <Route path="/api-test/scene-set" element={<ScenarioSetList basePath="/api-test" testType="api" />} />
                <Route path="/api-test/scene-set/:id" element={<ScenarioSetDetail basePath="/api-test" testType="api" />} />
                <Route path="/api-test/schedule" element={<ScheduleList basePath="/api-test" />} />
                <Route path="/api-test/schedule/:id" element={<ScheduleDetail testType="api" />} />
                <Route path="/api-test/batch-report" element={<BatchReportList basePath="/api-test" testType="api" />} />
                <Route path="/api-test/batch-report/:id" element={<BatchReportDetail testType="api" />} />
                <Route path="/api-test/mock" element={<MockList basePath="/api-test" testType="api" />} />
                <Route path="/api-test/mock/:id" element={<MockDetail testType="api" />} />
                <Route path="/api-test/environment" element={<EnvironmentList basePath="/api-test" testType="api" />} />
                <Route path="/api-test/environment/new" element={<EnvironmentDetail testType="api" />} />
                <Route path="/api-test/environment/:id" element={<EnvironmentDetail testType="api" />} />
                <Route path="/api-test/system-config" element={<SystemConfig />} />
                
                {/* === Web测试 /web-test === */}
                <Route path="/web-test" element={<WebTestHome />} />
                <Route path="/web-test/case" element={<WebCaseList />} />
                <Route path="/web-test/case/new" element={<WebCaseDetail />} />
                <Route path="/web-test/case/:id" element={<WebCaseDetail />} />
                <Route path="/web-test/scene" element={<ScenarioList basePath="/web-test" testType="web" />} />
                <Route path="/web-test/scene/:id" element={<ScenarioDetail basePath="/web-test" testType="web" />} />
                <Route path="/web-test/scene-set" element={<ScenarioSetList basePath="/web-test" testType="web" />} />
                <Route path="/web-test/scene-set/:id" element={<ScenarioSetDetail basePath="/web-test" testType="web" />} />
                <Route path="/web-test/schedule" element={<ScheduleList basePath="/web-test" />} />
                <Route path="/web-test/schedule/:id" element={<ScheduleDetail testType="web" />} />
                <Route path="/web-test/batch-report" element={<BatchReportList basePath="/web-test" testType="web" />} />
                <Route path="/web-test/batch-report/:id" element={<BatchReportDetail testType="web" />} />
                <Route path="/web-test/environment" element={<EnvironmentList basePath="/web-test" testType="web" />} />
                <Route path="/web-test/environment/new" element={<EnvironmentDetail testType="web" />} />
                <Route path="/web-test/environment/:id" element={<EnvironmentDetail testType="web" />} />
                <Route path="/web-test/system-config" element={<SystemConfig />} />
                
                {/* === 移动端测试 /mobile-test === */}
                <Route path="/mobile-test" element={<MobileTestHome />} />
                <Route path="/mobile-test/test-case" element={<MobileTestList />} />
                <Route path="/mobile-test/test-case/new" element={<MobileTestDetail />} />
                <Route path="/mobile-test/test-case/:id" element={<MobileTestDetail />} />
                <Route path="/mobile-test/scene-case" element={<ScenarioList basePath="/mobile-test" testType="mobile" />} />
                <Route path="/mobile-test/scene-case/:id" element={<ScenarioDetail basePath="/mobile-test" testType="mobile" />} />
                <Route path="/mobile-test/scene-set" element={<ScenarioSetList basePath="/mobile-test" testType="mobile" />} />
                <Route path="/mobile-test/scene-set/:id" element={<ScenarioSetDetail basePath="/mobile-test" testType="mobile" />} />
                <Route path="/mobile-test/schedule" element={<ScheduleList basePath="/mobile-test" />} />
                <Route path="/mobile-test/schedule/:id" element={<ScheduleDetail testType="mobile" />} />
                <Route path="/mobile-test/batch-report" element={<BatchReportList basePath="/mobile-test" testType="mobile" />} />
                <Route path="/mobile-test/batch-report/:id" element={<BatchReportDetail testType="mobile" />} />
                <Route path="/mobile-test/mock" element={<MockList basePath="/mobile-test" testType="mobile" />} />
                <Route path="/mobile-test/mock/:id" element={<MockDetail testType="mobile" />} />
                <Route path="/mobile-test/environment" element={<EnvironmentList basePath="/mobile-test" testType="mobile" />} />
                <Route path="/mobile-test/environment/new" element={<EnvironmentDetail testType="mobile" />} />
                <Route path="/mobile-test/environment/:id" element={<EnvironmentDetail testType="mobile" />} />
                <Route path="/mobile-test/system-config" element={<SystemConfig />} />
                
                {/* === PC测试 /pc-test === */}
                <Route path="/pc-test" element={<PcTestHome />} />
                <Route path="/pc-test/case" element={<PcCaseList />} />
                <Route path="/pc-test/case/new" element={<PcCaseDetail />} />
                <Route path="/pc-test/case/:id" element={<PcCaseDetail />} />
                <Route path="/pc-test/scene" element={<ScenarioList basePath="/pc-test" testType="pc" />} />
                <Route path="/pc-test/scene/:id" element={<ScenarioDetail basePath="/pc-test" testType="pc" />} />
                <Route path="/pc-test/scene-set" element={<ScenarioSetList basePath="/pc-test" testType="pc" />} />
                <Route path="/pc-test/scene-set/:id" element={<ScenarioSetDetail basePath="/pc-test" testType="pc" />} />
                <Route path="/pc-test/schedule" element={<ScheduleList basePath="/pc-test" />} />
                <Route path="/pc-test/schedule/:id" element={<ScheduleDetail testType="pc" />} />
                <Route path="/pc-test/batch-report" element={<BatchReportList basePath="/pc-test" testType="pc" />} />
                <Route path="/pc-test/batch-report/:id" element={<BatchReportDetail testType="pc" />} />
                <Route path="/pc-test/environment" element={<EnvironmentList basePath="/pc-test" testType="pc" />} />
                <Route path="/pc-test/environment/new" element={<EnvironmentDetail testType="pc" />} />
                <Route path="/pc-test/environment/:id" element={<EnvironmentDetail testType="pc" />} />
                <Route path="/pc-test/system-config" element={<SystemConfig />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </EnvironmentProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;