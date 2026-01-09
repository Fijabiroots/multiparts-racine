export declare class PriceRequestItemDto {
    reference?: string;
    description: string;
    quantity: number;
    unit?: string;
    notes?: string;
}
export declare class CreatePriceRequestDto {
    supplier?: string;
    supplierEmail?: string;
    items: PriceRequestItemDto[];
    notes?: string;
    deadline?: string;
}
export declare class ProcessEmailDto {
    emailId: string;
    supplierEmail?: string;
}
export declare class EmailFilterDto {
    folder?: string;
    subject?: string;
    from?: string;
    limit?: number;
    unseen?: boolean;
}
