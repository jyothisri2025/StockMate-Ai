import {
  BrowserRouter,
  Routes,
  Route
} from "react-router-dom";

import DashboardLayout from "./layout/DashboardLayout";

import About from "./pages/About";
import Chat from "./pages/Chat";
import Inventory from "./pages/Inventory";
import Settings from "./pages/Settings";
import Help from "./pages/Help";
import Login from "./pages/Login";
import History from "./pages/History";
import ImportInventory from "./pages/ImportInventory";
import Profile from "./pages/Profile";

function App() {

  return (
    <BrowserRouter>

      <Routes>

        <Route path="/login" element={<Login />} />
        <Route path="/import" element={<ImportInventory />} />

        <Route path="/" element={<DashboardLayout />}>
          <Route index element={<About />} />
          <Route path="profile" element={<Profile />} />
          <Route path="chat" element={<Chat />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="history" element={<History />} />
          <Route path="settings" element={<Settings />} />
          <Route path="help" element={<Help />} />
        </Route>

      </Routes>

    </BrowserRouter>
  );
}

export default App;