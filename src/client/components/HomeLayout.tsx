import { Outlet } from 'react-router-dom';
import Header from './Header';
import './HomeLayout.css';

export default function HomeLayout() {
  return (
    <div className="home-layout">
      <Header />
      <main className="home-layout-main">
        <Outlet />
      </main>
    </div>
  );
}
