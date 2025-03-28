import React, { useMemo } from 'react';
import { useDispatch } from 'react-redux';

import { RoomsListItem } from './RoomsListItem';

import addChannel from '@/assets/add-channel-icon.png';
import { openModal } from '@/slices/modalSlice';
import { useAppSelector } from '@/store';

export const RoomsList = () => {
  const dispatch = useDispatch();
  const allRoomIds = useAppSelector((state) => state.rooms.allRoomIds);
  const rooms = useAppSelector((state) => state.rooms.rooms);

  const handleOpenModal = (modalName: string) => {
    dispatch(openModal(modalName));
  };

  const { privateRooms, regularRooms } = useMemo(() => {
    const rRooms: string[] = [];
    const pRooms: string[] = [];
    allRoomIds.forEach((roomId: string) => {
      if (rooms[roomId].isPrivate) {
        pRooms.push(roomId);
      } else {
        rRooms.push(roomId);
      }
    });
    return { privateRooms: pRooms, regularRooms: rRooms };
  }, [allRoomIds, rooms]);

  if (!allRoomIds.length) return null;

  return (
    <div className="rooms">
      <div className="list-header">
        <h2 className="channels">Channels</h2>
        <button className="room-form-button" onClick={() => handleOpenModal('newRoom')}>
          <img src={addChannel} alt="add-channel-icon" />
        </button>
      </div>
      <ul className="roomsList">
        {regularRooms.map((roomId) => (
          <RoomsListItem key={roomId} roomId={roomId} />
        ))}
      </ul>
      <h2 className="channels">Direct Messages</h2>
      <button className="room-form-button" onClick={() => handleOpenModal('newDMForm')}>
        <img src={addChannel} alt="add-channel-icon" />
      </button>
      <ul className="roomsList">
        {privateRooms.map((roomId) => (
          <RoomsListItem key={roomId} roomId={roomId} />
        ))}
      </ul>
    </div>
  );
};
