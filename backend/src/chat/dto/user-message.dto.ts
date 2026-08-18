import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ValidateNested } from 'class-validator';
import { ChatMessageDto } from './chat-message.dto';

export class UserMessageDto {
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  messages!: ChatMessageDto[];
}
