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
import ScheduleList from './pages/schedule/ScheduleList';
import ScheduleDetail from './pages/schedule/ScheduleDetail';
import EnvironmentList from './pages/environment/EnvironmentList';
import EnvironmentDetail from './pages/environment/EnvironmentDetail';
import Placeholder from './pages/Placeholder';
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
                <Route path="/api-test/scene-case" element={<ScenarioList />} />
                <Route path="/api-test/scene-case/:id" element={<ScenarioDetail />} />
                <Route path="/api-test/scene-set" element={<ScenarioSetList />} />
                <Route path="/api-test/scene-set/:id" element={<ScenarioSetDetail />} />
                <Route path="/api-test/schedule" element={<ScheduleList />} />
                <Route path="/api-test/schedule/:id" element={<ScheduleDetail />} />
                <Route path="/api-test/batch-report" element={<BatchReportList />} />
                <Route path="/api-test/mock" element={<MockList />} />
                <Route path="/api-test/mock/:id" element={<MockDetail />} />
                <Route path="/api-test/environment" element={<EnvironmentList />} />
                <Route path="/api-test/environment/new" element={<EnvironmentDetail />} />
                <Route path="/api-test/environment/:id" element={<EnvironmentDetail />} />
                
                {/* === Web测试 /web-test === */}
                <Route path="/web-test" element={<Placeholder title="Web测试" />} />
                
                {/* === 移动端测试 /mobile-test === */}
                <Route path="/mobile-test" element={<Placeholder title="移动端测试" />} />
                
                {/* === PC测试 /pc-test === */}
                <Route path="/pc-test" element={<Placeholder title="PC测试" />} />
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