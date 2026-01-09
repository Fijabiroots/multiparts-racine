import { IsString, IsOptional, IsNumber, IsArray, ValidateNested, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class PriceRequestItemDto {
  @IsOptional()
  @IsString()
  reference?: string;

  @IsString()
  description: string;

  @IsNumber()
  quantity: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreatePriceRequestDto {
  @IsOptional()
  @IsString()
  supplier?: string;

  @IsOptional()
  @IsString()
  supplierEmail?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceRequestItemDto)
  items: PriceRequestItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString()
  deadline?: string;
}

export class ProcessEmailDto {
  @IsString()
  emailId: string;

  @IsOptional()
  @IsString()
  supplierEmail?: string;
}

export class EmailFilterDto {
  @IsOptional()
  @IsString()
  folder?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsNumber()
  limit?: number;

  @IsOptional()
  unseen?: boolean;
}
