import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import HomeLayout from './components/HomeLayout';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ChangePassword from './pages/ChangePassword';
import Home from './pages/Home';
import ApiList from './pages/api-test/ApiList';
import ApiDetail from './pages/api-test/ApiDetail';
import Placeholder from './pages/Placeholder';
import Profile from './pages/Profile';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route element={<ProtectedRoute />}>
            {/* 首页：无侧边栏 */}
            <Route element={<HomeLayout />}>
              <Route path="/" element={<Home />} />
            </Route>
            {/* 测试工作页：带侧边栏 */}
            <Route element={<Layout />}>
              <Route path="/profile" element={<Profile />} />
              <Route path="/change-password" element={<ChangePassword />} />
              <Route path="/api-test" element={<ApiList />} />
              <Route path="/api-test/:id" element={<ApiDetail />} />
              <Route path="/scenario" element={<Placeholder title="场景用例" />} />
              <Route path="/schedule" element={<Placeholder title="定时执行" />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
