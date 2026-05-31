import { Outlet } from 'react-router-dom';
import './HomeLayout.css';

export default function HomeLayout() {
  return (
    <div className="home-layout">
      <Outlet />
    </div>
  );
}
