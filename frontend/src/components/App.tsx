import React from 'react';
import { useDispatch } from 'react-redux';

import loggedInIcon from '../assets/images/logged-in-icon.png';
import { logout } from '../slices/authSlice';
import { useAppSelector } from '../store';

import MessagesAreaContainer from './messages/messages_area_container';
import { RoomsList } from './rooms/RoomsList';

const MainApp = () => {
  const dispatch = useDispatch();
  const username = useAppSelector((state) => state.auth.user?.username);
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    dispatch(logout());
  };

  return (
    <div className="main-app">
      <div className="side-nav">
        <header className="side-nav-header">
          {isAuthenticated && (
            <>
              <p id="username">
                <img id="presence" src={loggedInIcon} alt="logged-in" /> {username}
              </p>
              <button id="nav-logout" onClick={handleClick}>
                Log Out
              </button>
            </>
          )}
        </header>
        <RoomsList />
      </div>
      <MessagesAreaContainer />
    </div>
  );
};

export default MainApp;
