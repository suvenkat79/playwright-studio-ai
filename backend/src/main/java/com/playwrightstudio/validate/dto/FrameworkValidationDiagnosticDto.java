package com.playwrightstudio.validate.dto;

public class FrameworkValidationDiagnosticDto {
    private String file;
    private Integer line;
    private Integer column;
    private String code;
    private String message;

    public FrameworkValidationDiagnosticDto() {}

    public String getFile() { return file; }
    public void setFile(String file) { this.file = file; }

    public Integer getLine() { return line; }
    public void setLine(Integer line) { this.line = line; }

    public Integer getColumn() { return column; }
    public void setColumn(Integer column) { this.column = column; }

    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }

    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }
}
