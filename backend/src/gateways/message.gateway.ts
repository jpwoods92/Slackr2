import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  WebSocketServer,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards } from '@nestjs/common';
import { MessageService } from '../services/message.service';
import { CreateMessageDto } from '../dto/message/create-message.dto';
import { UpdateMessageDto } from '../dto/message/update-message.dto';
import { JwtService } from '@nestjs/jwt';
import { WsJwtGuard } from '../guards/ws-jwt.guard';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
@ApiTags('messages')
export class MessageGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  // Map to track connected members in each room
  private roomMembers: Map<string, Set<string>> = new Map();

  constructor(
    private readonly messageService: MessageService,
    private readonly jwtService: JwtService,
  ) {}

  @ApiOperation({ summary: 'Handle WebSocket connection' })
  @ApiResponse({ status: 200, description: 'Connection successful' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async handleConnection(client: Socket) {
    try {
      // Extract JWT token from handshake
      const token = client.handshake.auth.token as string;
      if (!token) {
        client.disconnect();
        return;
      }

      // Validate token
      const payload: { sub: string } = await this.jwtService.verify(token);
      client.data = { user: payload };

      // Join user to their user-specific room for private messages
      await client.join(`user:${payload.sub}`);
    } catch (err: unknown) {
      if (err instanceof Error) {
        console.error('Connection error:', err.message);
      }
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    try {
      // Get user ID from client data
      const userId = (client.data as { user: { sub: string } })?.user?.sub;

      if (userId) {
        // Remove user from all rooms they were in
        this.roomMembers.forEach((members, roomId) => {
          if (members.has(userId)) {
            members.delete(userId);
            // Emit updated member list to all clients in the room
            this.server
              .to(`room:${roomId}`)
              .emit('roomMembers', Array.from(members));
            // Notify other users that this user left the room
            this.server.to(`room:${roomId}`).emit('userLeft', {
              userId,
              roomId,
            });
          }
        });
      }
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('joinRoom')
  @ApiOperation({ summary: 'Join a room' })
  @ApiResponse({ status: 200, description: 'Joined room successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() roomId: string,
  ) {
    // Add user to room channel
    await client.join(`room:${roomId}`);

    const userId = (client.data as { user: { sub: string } }).user.sub;

    // Add user to room members tracking
    if (!this.roomMembers.has(roomId)) {
      this.roomMembers.set(roomId, new Set());
    }
    this.roomMembers.get(roomId)?.add(userId);

    // Fetch existing messages for this room
    const messages = await this.messageService.findAllByRoom(roomId, userId);

    // Emit message history to the client who just joined
    client.emit('messageHistory', messages);

    // Emit current room members to the client who just joined
    const currentMembers = Array.from(this.roomMembers.get(roomId) || []);
    this.server.to(`room:${roomId}`).emit('roomMembers', currentMembers);

    // Notify other users that this user joined the room
    this.server.to(`room:${roomId}`).emit('userJoined', {
      userId,
      roomId,
    });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('leaveRoom')
  @ApiOperation({ summary: 'Leave a room' })
  @ApiResponse({ status: 200, description: 'Left room successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() roomId: string,
  ) {
    await client.leave(`room:${roomId}`);
    const userId = (client.data as { user: { sub: string } }).user.sub;

    // Remove user from room members tracking
    if (this.roomMembers.has(roomId)) {
      this.roomMembers.get(roomId)?.delete(userId);

      // Emit updated member list to all clients in the room
      const currentMembers = Array.from(this.roomMembers.get(roomId) || []);
      this.server.to(`room:${roomId}`).emit('roomMembers', currentMembers);
    }

    // Notify other users that this user left the room
    this.server.to(`room:${roomId}`).emit('userLeft', {
      userId,
      roomId,
    });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('sendMessage')
  @ApiOperation({ summary: 'Send a message' })
  @ApiResponse({ status: 200, description: 'Message sent successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() createMessageDto: CreateMessageDto,
  ) {
    try {
      const userId = (client.data as { user: { sub: string } }).user.sub;
      const message = await this.messageService.create(
        userId,
        createMessageDto,
      );

      // Broadcast the message to all clients in the room
      // The message object already includes the user relation from the service
      this.server
        .to(`room:${createMessageDto.roomId}`)
        .emit('newMessage', message);

      return { success: true, message };
    } catch (error) {
      if (error instanceof Error) {
        return { success: false, error: error.message };
      }
      return { success: false, error: 'An unknown error occurred' };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('updateMessage')
  @ApiOperation({ summary: 'Update a message' })
  @ApiResponse({ status: 200, description: 'Message updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Forbidden - not message owner' })
  async handleUpdateMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { id: string; content: string },
  ) {
    try {
      const userId = (client.data as { user: { sub: string } }).user.sub;
      const updateMessageDto: UpdateMessageDto = { content: payload.content };

      // Update the message
      const updatedMessage = await this.messageService.update(
        payload.id,
        userId,
        updateMessageDto,
      );

      // Broadcast the updated message to all clients in the room
      this.server
        .to(`room:${updatedMessage.roomId}`)
        .emit('messageUpdated', updatedMessage);

      return { success: true, message: updatedMessage };
    } catch (error) {
      if (error instanceof Error) {
        return { success: false, error: error.message };
      }
      return { success: false, error: 'An unknown error occurred' };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('deleteMessage')
  @ApiOperation({ summary: 'Delete a message' })
  @ApiResponse({ status: 200, description: 'Message deleted successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - not message owner or room owner',
  })
  async handleDeleteMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() messageId: string,
  ) {
    try {
      const userId = (client.data as { user: { sub: string } }).user.sub;

      // Get the message first to know which room to notify
      const message = await this.messageService.findOne(messageId, userId);
      const roomId = message.roomId;

      // Delete the message
      await this.messageService.remove(messageId, userId);

      // Notify all clients in the room about the deletion
      this.server
        .to(`room:${roomId}`)
        .emit('messageDeleted', { id: messageId, roomId });

      return { success: true };
    } catch (error) {
      if (error instanceof Error) {
        return { success: false, error: error.message };
      }
      return { success: false, error: 'An unknown error occurred' };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('getRoomMembers')
  @ApiOperation({ summary: 'Get current members in a room' })
  @ApiResponse({
    status: 200,
    description: 'Room members retrieved successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  handleGetRoomMembers(
    @ConnectedSocket() client: Socket,
    @MessageBody() roomId: string,
  ) {
    try {
      // Get current members for the room
      const members = this.roomMembers.has(roomId)
        ? Array.from(this.roomMembers.get(roomId) || [])
        : [];

      // Send members list to the requesting client
      client.emit('roomMembers', members);

      return { success: true, members };
    } catch (error) {
      if (error instanceof Error) {
        return { success: false, error: error.message };
      }
      return { success: false, error: 'An unknown error occurred' };
    }
  }
}
